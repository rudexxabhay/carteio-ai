CREATE TABLE "FlowDefinition" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "graph" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlowDefinition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlowDefinition_version_check" CHECK ("version" >= 1),
  CONSTRAINT "FlowDefinition_graph_object_check" CHECK (jsonb_typeof("graph") = 'object'),
  CONSTRAINT "FlowDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FlowDefinition_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FlowDefinition_organizationId_assistantId_name_key" UNIQUE ("organizationId", "assistantId", "name"),
  CONSTRAINT "FlowDefinition_id_organizationId_key" UNIQUE ("id", "organizationId")
);
CREATE INDEX "FlowDefinition_organizationId_assistantId_updatedAt_idx" ON "FlowDefinition"("organizationId", "assistantId", "updatedAt");
