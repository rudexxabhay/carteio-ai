# Initial database schema

The schema is an initial foundation only. It does not implement authentication, authorization, business endpoints, or tenant RLS. IDs are PostgreSQL UUIDs. Times are UTC `timestamptz`; `updatedAt` is maintained by Prisma. Foreign keys use restrictive deletion by default so organization records cannot be removed accidentally through a cascade.

| Model | Purpose and constraints |
| --- | --- |
| `User` | Canonical lowercase email is unique; optional name and email verification time; no password field. Writers must trim and lowercase email before persistence. |
| `Organization` | Company record with unique slug and lifecycle status. |
| `OrganizationMembership` | User-to-organization association with owner/admin/member role and pending/active/suspended/removed status. `(userId, organizationId)` is unique; a removed membership is reactivated on the same row rather than duplicated. |
| `Website` | Organization-owned domain, unverified by default. Domain is unique within its organization. Registration does not imply domain verification. |
| `Chatbot` | Organization-owned assistant placeholder; optional website is constrained to the same organization. No AI configuration or execution is implemented. |
| `Integration` | Organization-owned future provider reference; optional website must belong to the same organization. It contains no credential fields. |
| `AuditEvent` | Append-oriented event record, optionally scoped to an organization and actor. Metadata is JSONB for narrowly allowlisted, non-sensitive attributes only. No public API exposes it. |

All organization-owned entities have an `organizationId` index. Relations to a website use the unique `(id, organizationId)` key, not only the website ID. This prevents a chatbot/integration from attaching a website owned by another organization at the database constraint level. Deletes are restricted where dependent business records exist. Actor deletion sets the optional actor reference to null; audit history is retained.

Email normalization is a write-path invariant for this initial schema: store a trimmed lowercase address and rely on the unique field constraint. A future service/migration should add a PostgreSQL check constraint (`email = lower(email)`) if direct SQL writers are introduced; Prisma's schema does not express that check here. Membership uniqueness intentionally also limits historical memberships to one row per user/organization pair.

No billing, credential, conversation, knowledge, vector, or user-authentication models are included.
