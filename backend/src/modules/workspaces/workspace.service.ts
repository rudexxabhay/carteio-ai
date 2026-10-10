import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CreateWorkspaceDto, UpdateWorkspaceDto, WorkspacePaginationDto } from './workspace.dto';

const reservedSlugs = new Set([
  'admin', 'api', 'auth', 'dashboard', 'docs', 'help', 'login', 'logout', 'onboarding',
  'public', 'settings', 'signup', 'static', 'support', 'team', 'www', 'workspace', 'workspaces',
]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isUniqueConflict = (error: unknown) => isRecord(error) && error.code === 'P2002';

export function normalizeWorkspaceSlug(value: string): string {
  const slug = value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new BadRequestException({ code: 'INVALID_WORKSPACE_SLUG', message: 'Use 1–63 letters, numbers, or single hyphens in the workspace URL.' });
  }
  if (reservedSlugs.has(slug)) {
    throw new BadRequestException({ code: 'RESERVED_WORKSPACE_SLUG', message: 'That workspace URL is reserved. Choose another.' });
  }
  return slug;
}

function normalizeWebsite(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new BadRequestException({ code: 'INVALID_WEBSITE_URL', message: 'Enter a valid http or https website URL.' });
  }
}

function workspaceView(organization: any, role: string) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    websiteUrl: organization.websiteUrl ?? null,
    businessType: organization.businessType ?? null,
    status: organization.status.toLowerCase(),
    role: role.toLowerCase(),
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

@Injectable()
export class WorkspaceService {
  private readonly db: any;

  constructor(prisma: PrismaService) { this.db = prisma; }

  async create(userId: string, input: CreateWorkspaceDto) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 200) {
      throw new BadRequestException({ code: 'INVALID_WORKSPACE_NAME', message: 'Workspace name must be between 2 and 200 characters.' });
    }
    const slug = normalizeWorkspaceSlug(input.slug);
    const businessType = input.businessType?.trim() || null;
    if (businessType && businessType.length > 80) {
      throw new BadRequestException({ code: 'INVALID_BUSINESS_TYPE', message: 'Business type must be 80 characters or fewer.' });
    }
    const websiteUrl = normalizeWebsite(input.websiteUrl);

    try {
      const organization = await this.db.$transaction(async (tx: any) => {
        const created = await tx.organization.create({
          data: { name, slug, websiteUrl, businessType, status: 'ACTIVE' },
        });
        await tx.organizationMembership.create({
          data: { organizationId: created.id, userId, role: 'OWNER', status: 'ACTIVE' },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: created.id,
            actorUserId: userId,
            action: 'workspace.created',
            entityType: 'organization',
            entityId: created.id,
            metadata: { slug, role: 'OWNER' },
          },
        });
        return created;
      });
      return workspaceView(organization, 'OWNER');
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException({ code: 'WORKSPACE_SLUG_UNAVAILABLE', message: 'That workspace URL is already in use.' });
      }
      throw error;
    }
  }

  async list(userId: string, pagination: WorkspacePaginationDto) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.pageSize ?? 25;
    const where = {
      userId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    };
    const [memberships, total] = await Promise.all([
      this.db.organizationMembership.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { organizationId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          role: true,
          organization: {
            select: { id: true, name: true, slug: true, websiteUrl: true, businessType: true, status: true, createdAt: true, updatedAt: true },
          },
        },
      }),
      this.db.organizationMembership.count({ where }),
    ]);
    return { workspaces: memberships.map((membership: any) => workspaceView(membership.organization, membership.role)), page, pageSize, total };
  }

  async getAuthorized(userId: string, slug: string) {
    const membership = await this.db.organizationMembership.findFirst({
      where: { userId, status: 'ACTIVE', organization: { slug, status: 'ACTIVE' } },
      select: {
        role: true,
        organization: { select: { id: true, name: true, slug: true, websiteUrl: true, businessType: true, status: true, createdAt: true, updatedAt: true } },
      },
    });
    if (!membership) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' });
    return { ...workspaceView(membership.organization, membership.role), currentUserRole: membership.role.toLowerCase() };
  }

  async update(userId: string, slug: string, input: UpdateWorkspaceDto) {
    const membership = await this.requireAccess(userId, slug, ['OWNER', 'ADMIN']);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 200) throw new BadRequestException({ code: 'INVALID_WORKSPACE_NAME', message: 'Workspace name must be between 2 and 200 characters.' });
      data.name = name;
    }
    if (input.websiteUrl !== undefined) data.websiteUrl = normalizeWebsite(input.websiteUrl);
    if (input.businessType !== undefined) {
      const value = input.businessType?.trim() || null;
      if (value && value.length > 80) throw new BadRequestException({ code: 'INVALID_BUSINESS_TYPE', message: 'Business type must be 80 characters or fewer.' });
      data.businessType = value;
    }
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_WORKSPACE_UPDATE', message: 'Choose at least one workspace setting to update.' });

    const updated = await this.db.$transaction(async (tx: any) => {
      const organization = await tx.organization.update({ where: { id: membership.organizationId }, data });
      await tx.auditEvent.create({
        data: {
          organizationId: membership.organizationId,
          actorUserId: userId,
          action: 'workspace.updated',
          entityType: 'organization',
          entityId: membership.organizationId,
          metadata: { changedFields: Object.keys(data) },
        },
      });
      return organization;
    });
    return workspaceView(updated, membership.role);
  }

  async members(userId: string, slug: string, pagination: WorkspacePaginationDto) {
    const membership = await this.requireAccess(userId, slug);
    const where = { organizationId: membership.organizationId, status: 'ACTIVE' };
    const [members, total] = await Promise.all([
      this.db.organizationMembership.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: ((pagination.page ?? 1) - 1) * (pagination.pageSize ?? 25),
        take: pagination.pageSize ?? 25,
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
      }),
      this.db.organizationMembership.count({ where }),
    ]);
    return {
      members: members.map((member: any) => ({ id: member.user.id, name: member.user.name, role: member.role.toLowerCase(), joinedAt: member.createdAt })),
      page: pagination.page ?? 1,
      pageSize: pagination.pageSize ?? 25,
      total,
      currentUserRole: membership.role.toLowerCase(),
    };
  }

  /** Reusable tenant boundary for future websites, assistants, knowledge and integrations APIs. */
  async requireAccess(userId: string, slug: string, allowedRoles?: readonly ('OWNER' | 'ADMIN' | 'MEMBER')[]) {
    const membership = await this.db.organizationMembership.findFirst({
      where: { userId, status: 'ACTIVE', organization: { slug, status: 'ACTIVE' } },
      select: { organizationId: true, role: true },
    });
    if (!membership) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' });
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException({ code: 'WORKSPACE_ROLE_REQUIRED', message: 'You do not have permission to manage this workspace.' });
    }
    return membership;
  }
}
