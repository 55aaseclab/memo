import { createBusinessHooks } from './praxis/business-hooks.mjs';
import { createWebIntegration } from './praxis/web.mjs';
import { createStorageIntegration } from './praxis/storage.mjs';
import { createDeploymentIntegration } from './praxis/deployment.mjs';
import { createMemoSchema } from './praxis/memo-schema.mjs';

export function createIntegration({ z }) {
const businessError=(status,code)=>Object.assign(new Error(code),{status,code});
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/);
const common = { spaceId: id }, mutation = { ...common, idempotencyKey: id };
function planningInput(schema, args) {
  const { spaceId: ignoredSpace, resourceId: ignoredResource, expectedRevision: ignoredRevision, idempotencyKey: ignoredKey, ...input } = args;
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw businessError(400, 'INVALID_INPUT');
  return parsed.data;
}
const memoSchema = createMemoSchema(z);
const { memoTopicSchema, memoIdSchema, memoRevisionSchema, memoGuideFields, memoGuideSchema, memoRecordIdSchema, memoRecordSchema, memoRecordsSchema, MEMO_RECORD_OPERATIONS, memoInputs } = memoSchema;
const operationActions={"read_records":"read","put_record":"update","delete_record":"update","import_records":"update","replace_records":"update","list_topics":"read","read_topic":"read","events":"read","set_guide":"update","archive_guide":"update"};
const operations=Object.fromEntries(Object.entries(operationActions).map(([name,action])=>[name,{action,mutation:action!=='read'}]));
for(const name of MEMO_RECORD_OPERATIONS)operations[name].maxRequestBytes=10*1024*1024;
const observedCapabilities={"read_records":"other","put_record":"other","delete_record":"other","import_records":"other","replace_records":"other","list_topics":"read","read_topic":"read","events":"read","set_guide":"update","archive_guide":"update"};
for(const [name,definition]of Object.entries(operations))definition.capability=observedCapabilities[name];
function validateInvocation(request) {
const {appId,operation,spaceId,resourceId}=request;const action=operationActions[operation];
if(request.sourceResourceId!==undefined)throw businessError(400,'INVALID_REQUEST');
if (appId === 'memo') {
    if (['list_topics', 'events'].includes(operation) ? resourceId !== undefined : !(MEMO_RECORD_OPERATIONS.includes(operation) ? resourceId === 'records' : memoTopicSchema.safeParse(resourceId).success)) throw businessError(400, 'INVALID_REQUEST');
    if (action === 'update' ? !memoRevisionSchema.safeParse(request.expectedRevision).success : request.expectedRevision !== undefined) throw businessError(400, 'INVALID_REVISION');
    if (action === 'read' && request.idempotencyKey !== undefined) throw businessError(400, 'INVALID_REQUEST');
    if (!memoInputs[operation].safeParse(request.input || {}).success) throw businessError(400, 'INVALID_INPUT');
  }
}
return {schemaVersion:1,appId:"memo",web:createWebIntegration(),storage:createStorageIntegration(),deployment:createDeploymentIntegration(),business:{adapterId:"memo",actions:["read","update"],scopes:{"memo:read":["read"],"memo:write":["update"]},targetedCreate:false,operations,tools:[
{ name: 'memo_list_topics', appId: 'memo', operation: 'list_topics', action: 'read', description: 'List only authorized Memo guide topics in one space. rights and rental are separate resource boundaries. This reads no browser photos, receipts, timers or local storage.', schema: z.object(common).strict() },
{ name: 'memo_read_topic', appId: 'memo', operation: 'read_topic', action: 'read', description: 'Read one authorized Memo topic, its current revision, plain-text guides and source metadata. Read this before changing a guide. Topic IDs are rights or rental; neither grants access to the other.', schema: z.object({ ...common, resourceId: memoTopicSchema }).strict() },
{ name: 'memo_set_guide', appId: 'memo', operation: 'set_guide', action: 'update', description: 'Create or revise one plain-text guide within the authorized rights or rental topic. Supply a stable guide id, title, blocks of optional heading plus ordered items, and Knowledge source path, entryId and version. Preserve unrequested content. No Markdown/HTML layout, code, host path or browser-record modification. Requires the current topic expectedRevision (0 for an empty topic) and a stable idempotency key; read back before reporting success.', schema: z.object({ ...mutation, resourceId: memoTopicSchema, expectedRevision: memoRevisionSchema, ...memoGuideFields }).strict(), input: args => planningInput(memoGuideSchema, args) },
{ name: 'memo_archive_guide', appId: 'memo', operation: 'archive_guide', action: 'update', description: 'Archive one identified guide within an authorized Memo topic while preserving immutable history. Requires the current topic revision and stable idempotency key. This never removes source documents, photos, receipts or timers. Read back the topic to confirm the guide is no longer active.', schema: z.object({ ...mutation, resourceId: memoTopicSchema, expectedRevision: memoRevisionSchema, id: memoIdSchema }).strict(), input: args => ({ id: args.id }) }
],skill:{name:"mcp-memo",path:"skills/mcp-memo/SKILL.md"},instructions:["Memo guides use fixed rights and rental topic resources with independent authorization. Read the matching topic and current revision, then use only typed guide blocks and truthful source metadata. When moving Knowledge content, preserve its text, save and read back all destination guides before replacing the source subsection with links; retain source history and all unrelated content. Memo tools cannot read or alter browser-local photos, records, preferences or timers."],invokeAliases:[{path:'/api/business/memo-records',operations:MEMO_RECORD_OPERATIONS,maxRequestBytes:10*1024*1024}],validateInvocation,...createBusinessHooks({MEMO_RECORD_OPERATIONS}),schemas:{memoTopicSchema,memoIdSchema,memoRevisionSchema,memoGuideFields,memoGuideSchema,memoRecordIdSchema,memoRecordSchema,memoRecordsSchema,MEMO_RECORD_OPERATIONS,memoInputs},events:{operation:'events'}}};
}
