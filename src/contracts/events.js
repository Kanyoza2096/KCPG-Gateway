'use strict';

/**
 * Event names: KCPG canonical + Python core aliases.
 * Python UnifiedEventBus / organism filters use names like director.proposal,
 * council.decided, post.published, heartbeat.beat — map both ways in the bridge.
 *
 * V1.6: added workforce.* and business.workflow.* namespaces. The V71.16
 * AutonomousLoop workforce bridge publishes workforce.proposal; without these
 * entries the KCPG event ingress rejects it with "Unknown event type".
 *
 * V1.7 (2026-10-09): added job.created. The Python core emits job.created and
 * job.status_changed from JobService on every job lifecycle transition. The
 * bridge forwards both. job.status_changed was already in EVENTS but not
 * routed to a namespace; job.created was absent entirely, so the ingress
 * rejected it with "Unknown event type: job.created". Both are now declared,
 * aliased (snake_case variants for backward-compatible emitters), and routed
 * to the DASHBOARD namespace.
 *
 * V1.8 (2026-10-30): added dream.insight and dream.completed. The DreamSystem
 * in core/dreams.py publishes dream.insight on the internal bus after every
 * cycle; the kcpg_event_bridge forwards it to KCPG ingress, which previously
 * rejected it with "Unknown event type: dream.insight". Both are declared,
 * aliased (snake_case for future emitters), and routed to DASHBOARD so the
 * frontend live event feed surfaces dream insights to the operator.
 */
const EVENTS = Object.freeze({
  // KCPG / Control Plane canonical
  SYSTEM_HEALTH_CHANGED: 'system.health.changed',
  AUTONOMY_STATE_CHANGED: 'autonomy.state.changed',
  DIRECTOR_DECISION_CREATED: 'director.decision.created',
  COUNCIL_DELIBERATION_STARTED: 'council.deliberation.started',
  COUNCIL_VOTE_CAST: 'council.vote.cast',
  COUNCIL_CONSENSUS_REACHED: 'council.consensus.reached',
  META_IMPROVEMENT_PROPOSED: 'meta.improvement.proposed',
  ORGANISM_STATUS_CHANGED: 'organism.status.changed',
  ORGANISM_BLOCKAGE_DETECTED: 'organism.blockage.detected',
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',
  LLM_RUN_COMPLETED: 'llm.run.completed',
  INCIDENT_CREATED: 'incident.created',
  INCIDENT_RESOLVED: 'incident.resolved',
  PUBLISH_COMPLETED: 'publish.completed',
  COMMAND_RESULT: 'command.result',

  // Python core aliases (organism body event buckets)
  HEARTBEAT_BEAT: 'heartbeat.beat',
  SERVICE_HEARTBEAT: 'service_heartbeat',
  PULSE_STAGNANT: 'pulse.stagnant',
  PULSE_CLEARED: 'pulse.cleared',
  CIRCULATION_BLOCKAGE: 'circulation.blockage',
  SPECIES_BOOT: 'species.boot',
  ORGANISM_BORN: 'organism.born',
  DIRECTOR_PROPOSAL: 'director.proposal',
  DIRECTOR_BRIEFING: 'director.briefing',
  ACTION_PROPOSED: 'action.proposed',
  PUBLISH_REQUEST: 'publish_request',
  COUNCIL_DECIDED: 'council.decided',
  INTELLIGENT_DECISION: 'intelligent_decision',
  POST_PUBLISHED: 'post.published',
  POST_PUBLISHED_ALT: 'post_published',
  JOB_COMPLETED: 'job.completed',
  JOB_FAILED: 'job.failed',
  JOB_STATUS_CHANGED: 'job.status_changed',

  // ✅ V1.7 — Job lifecycle (JobService emits both on every transition)
  JOB_CREATED: 'job.created',

  REFLEX_FIRED: 'reflex.fired',

  // ✅ MetaEngine / Reliability / Autonomous Loop events
  ENGINE_ALERT: 'engine_alert',
  RELIABILITY_OUTCOME: 'reliability.outcome',
  ESCALATION_REQUEST: 'escalation_request',
  ANOMALY_RESPONSE: 'anomaly_response',
  PREDICTION_ALERT: 'prediction_alert',
  PATTERN_DISCOVERED: 'pattern_discovered',
  HEAL_COMMAND: 'heal_command',
  CONTENT_FAILED: 'content.failed',
  CONTENT_RETRY: 'content_retry',

  // ✅ Plugin lifecycle events
  PLUGIN_STARTED: 'plugin.started',
  PLUGIN_STOPPED: 'plugin.stopped',
  PLUGIN_FAILED: 'plugin.failed',

  // ✅ Director task lifecycle (Director v5.x publishes snake_case)
  TASK_CREATED: 'task.created',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',

  // ✅ Director operational events
  DIRECTOR_BRIEFING_EVENT: 'director.briefing.event',
  BRAND_HEALTH_UPDATED: 'organism.brand.health.updated',
  MEMORY_STORED: 'organism.memory.stored',

  // ✅ V1.8 — Dream system events (nightly dream cycle output)
  DREAM_INSIGHT: 'dream.insight',
  DREAM_COMPLETED: 'dream.completed',

  // ✅ V1.6 — Workforce events (V71.16 AutonomousLoop → Governed Workforce)
  WORKFORCE_PROPOSAL: 'workforce.proposal',
  WORKFORCE_PROPOSAL_APPROVED: 'workforce.proposal.approved',
  WORKFORCE_PROPOSAL_REJECTED: 'workforce.proposal.rejected',
  WORKFORCE_EXECUTION_REQUESTED: 'workforce.execution.requested',
  WORKFORCE_EXECUTION_STARTED: 'workforce.execution.started',
  WORKFORCE_EXECUTION_COMPLETED: 'workforce.execution.completed',
  WORKFORCE_EXECUTION_FAILED: 'workforce.execution.failed',
  WORKFORCE_EXECUTION_UNCERTAIN: 'workforce.execution.uncertain',

  // ✅ V1.6 — Business workflow lifecycle (business_workflow_runs status)
  BUSINESS_WORKFLOW_RECEIVED: 'business.workflow.received',
  BUSINESS_WORKFLOW_UNDERSTANDING: 'business.workflow.understanding',
  BUSINESS_WORKFLOW_DECISION: 'business.workflow.decision',
  BUSINESS_WORKFLOW_APPROVAL_REQUIRED: 'business.workflow.approval_required',
  BUSINESS_WORKFLOW_EXECUTING: 'business.workflow.executing',
  BUSINESS_WORKFLOW_SUCCEEDED: 'business.workflow.succeeded',
  BUSINESS_WORKFLOW_FAILED: 'business.workflow.failed',
  BUSINESS_WORKFLOW_UNCERTAIN: 'business.workflow.uncertain',
  BUSINESS_WORKFLOW_CANCELLED: 'business.workflow.cancelled',
});

/** Normalize inbound Python event name → preferred KCPG name for clients */
const ALIASES_TO_CANONICAL = Object.freeze({
  'director.proposal': EVENTS.DIRECTOR_DECISION_CREATED,
  'director.briefing': EVENTS.DIRECTOR_DECISION_CREATED,
  'action.proposed': EVENTS.DIRECTOR_DECISION_CREATED,
  'council.decided': EVENTS.COUNCIL_CONSENSUS_REACHED,
  'intelligent_decision': EVENTS.DIRECTOR_DECISION_CREATED,
  'post.published': EVENTS.PUBLISH_COMPLETED,
  'post_published': EVENTS.PUBLISH_COMPLETED,
  'circulation.blockage': EVENTS.ORGANISM_BLOCKAGE_DETECTED,
  'pulse.stagnant': EVENTS.ORGANISM_STATUS_CHANGED,
  'organism.born': EVENTS.ORGANISM_STATUS_CHANGED,
  'job.completed': EVENTS.WORKFLOW_COMPLETED,
  'job.failed': EVENTS.WORKFLOW_FAILED,
  'engine_alert': EVENTS.ENGINE_ALERT,
  'reliability.outcome': EVENTS.RELIABILITY_OUTCOME,
  'escalation_request': EVENTS.ESCALATION_REQUEST,
  // ✅ Plugin aliases
  'plugin.started': EVENTS.PLUGIN_STARTED,
  'plugin.stopped': EVENTS.PLUGIN_STOPPED,
  'plugin.failed': EVENTS.PLUGIN_FAILED,
  // ✅ Director snake_case → canonical dot.notation
  'task_created': EVENTS.TASK_CREATED,
  'task_completed': EVENTS.TASK_COMPLETED,
  'task_failed': EVENTS.TASK_FAILED,
  'director_briefing': EVENTS.DIRECTOR_BRIEFING_EVENT,
  'brand_health_updated': EVENTS.BRAND_HEALTH_UPDATED,
  'memory.stored': EVENTS.MEMORY_STORED,

  // ✅ V1.6 — Workforce snake_case aliases
  'workforce_proposal': EVENTS.WORKFORCE_PROPOSAL,
  'workforce_proposal_approved': EVENTS.WORKFORCE_PROPOSAL_APPROVED,
  'workforce_proposal_rejected': EVENTS.WORKFORCE_PROPOSAL_REJECTED,
  'workforce_execution_requested': EVENTS.WORKFORCE_EXECUTION_REQUESTED,
  'workforce_execution_started': EVENTS.WORKFORCE_EXECUTION_STARTED,
  'workforce_execution_completed': EVENTS.WORKFORCE_EXECUTION_COMPLETED,
  'workforce_execution_failed': EVENTS.WORKFORCE_EXECUTION_FAILED,
  'workforce_execution_uncertain': EVENTS.WORKFORCE_EXECUTION_UNCERTAIN,
  'business_workflow_received': EVENTS.BUSINESS_WORKFLOW_RECEIVED,
  'business_workflow_understanding': EVENTS.BUSINESS_WORKFLOW_UNDERSTANDING,
  'business_workflow_decision': EVENTS.BUSINESS_WORKFLOW_DECISION,
  'business_workflow_approval_required': EVENTS.BUSINESS_WORKFLOW_APPROVAL_REQUIRED,
  'business_workflow_executing': EVENTS.BUSINESS_WORKFLOW_EXECUTING,
  'business_workflow_succeeded': EVENTS.BUSINESS_WORKFLOW_SUCCEEDED,
  'business_workflow_failed': EVENTS.BUSINESS_WORKFLOW_FAILED,
  'business_workflow_uncertain': EVENTS.BUSINESS_WORKFLOW_UNCERTAIN,
  'business_workflow_cancelled': EVENTS.BUSINESS_WORKFLOW_CANCELLED,

  // ✅ V1.7 — Job lifecycle snake_case aliases
  // The dot-notation forms (job.created, job.status_changed) are already
  // canonical, so these entries are no-ops today. They exist so a future
  // emitter that uses snake_case (matching the Director's task_* convention)
  // still resolves to the canonical names without requiring a contract edit.
  'job_created': EVENTS.JOB_CREATED,
  'job_status_changed': EVENTS.JOB_STATUS_CHANGED,

  // ✅ V1.8 — Dream system snake_case aliases
  'dream_insight': EVENTS.DREAM_INSIGHT,
  'dream_completed': EVENTS.DREAM_COMPLETED,
});

function canonicalEventName(type) {
  if (!type) return type;
  return ALIASES_TO_CANONICAL[type] || type;
}

const NAMESPACES = Object.freeze({
  DASHBOARD: '/dashboard',
  SYSTEM: '/system',
  COUNCIL: '/council',
  // ✅ V1.6 — workforce stream
  WORKFORCE: '/workforce',
});

const EVENT_NAMESPACE = Object.freeze({
  [EVENTS.SYSTEM_HEALTH_CHANGED]: NAMESPACES.SYSTEM,
  [EVENTS.AUTONOMY_STATE_CHANGED]: NAMESPACES.DASHBOARD,
  [EVENTS.DIRECTOR_DECISION_CREATED]: NAMESPACES.DASHBOARD,
  [EVENTS.DIRECTOR_PROPOSAL]: NAMESPACES.DASHBOARD,
  [EVENTS.COUNCIL_DELIBERATION_STARTED]: NAMESPACES.COUNCIL,
  [EVENTS.COUNCIL_VOTE_CAST]: NAMESPACES.COUNCIL,
  [EVENTS.COUNCIL_CONSENSUS_REACHED]: NAMESPACES.COUNCIL,
  [EVENTS.COUNCIL_DECIDED]: NAMESPACES.COUNCIL,
  [EVENTS.META_IMPROVEMENT_PROPOSED]: NAMESPACES.DASHBOARD,
  [EVENTS.ORGANISM_STATUS_CHANGED]: NAMESPACES.DASHBOARD,
  [EVENTS.ORGANISM_BLOCKAGE_DETECTED]: NAMESPACES.DASHBOARD,
  [EVENTS.CIRCULATION_BLOCKAGE]: NAMESPACES.SYSTEM,
  [EVENTS.WORKFLOW_STARTED]: NAMESPACES.DASHBOARD,
  [EVENTS.WORKFLOW_COMPLETED]: NAMESPACES.DASHBOARD,
  [EVENTS.WORKFLOW_FAILED]: NAMESPACES.DASHBOARD,
  [EVENTS.LLM_RUN_COMPLETED]: NAMESPACES.DASHBOARD,
  [EVENTS.INCIDENT_CREATED]: NAMESPACES.SYSTEM,
  [EVENTS.INCIDENT_RESOLVED]: NAMESPACES.SYSTEM,
  [EVENTS.PUBLISH_COMPLETED]: NAMESPACES.DASHBOARD,
  [EVENTS.POST_PUBLISHED]: NAMESPACES.DASHBOARD,
  [EVENTS.COMMAND_RESULT]: NAMESPACES.DASHBOARD,
  [EVENTS.ENGINE_ALERT]: NAMESPACES.SYSTEM,
  [EVENTS.RELIABILITY_OUTCOME]: NAMESPACES.SYSTEM,
  [EVENTS.ESCALATION_REQUEST]: NAMESPACES.SYSTEM,
  // ✅ Plugin namespaces
  [EVENTS.PLUGIN_STARTED]: NAMESPACES.SYSTEM,
  [EVENTS.PLUGIN_STOPPED]: NAMESPACES.SYSTEM,
  [EVENTS.PLUGIN_FAILED]: NAMESPACES.SYSTEM,
  // ✅ Director task lifecycle namespaces
  [EVENTS.TASK_CREATED]: NAMESPACES.DASHBOARD,
  [EVENTS.TASK_COMPLETED]: NAMESPACES.DASHBOARD,
  [EVENTS.TASK_FAILED]: NAMESPACES.SYSTEM,
  [EVENTS.DIRECTOR_BRIEFING_EVENT]: NAMESPACES.DASHBOARD,
  [EVENTS.BRAND_HEALTH_UPDATED]: NAMESPACES.DASHBOARD,
  [EVENTS.MEMORY_STORED]: NAMESPACES.SYSTEM,

  // ✅ V1.8 — Dream system namespaces
  // Dream insights are operator-facing; the dashboard surfaces them in the
  // live event feed and the morning briefing card.
  [EVENTS.DREAM_INSIGHT]: NAMESPACES.DASHBOARD,
  [EVENTS.DREAM_COMPLETED]: NAMESPACES.DASHBOARD,

  // ✅ V1.7 — Job lifecycle namespaces
  // The dashboard shows job progress in real time; both events belong there.
  [EVENTS.JOB_CREATED]: NAMESPACES.DASHBOARD,
  [EVENTS.JOB_STATUS_CHANGED]: NAMESPACES.DASHBOARD,

  // ✅ V1.6 — Workforce + Business workflow namespaces
  [EVENTS.WORKFORCE_PROPOSAL]: NAMESPACES.WORKFORCE,
  [EVENTS.WORKFORCE_PROPOSAL_APPROVED]: NAMESPACES.COUNCIL,
  [EVENTS.WORKFORCE_PROPOSAL_REJECTED]: NAMESPACES.COUNCIL,
  [EVENTS.WORKFORCE_EXECUTION_REQUESTED]: NAMESPACES.WORKFORCE,
  [EVENTS.WORKFORCE_EXECUTION_STARTED]: NAMESPACES.WORKFORCE,
  [EVENTS.WORKFORCE_EXECUTION_COMPLETED]: NAMESPACES.WORKFORCE,
  [EVENTS.WORKFORCE_EXECUTION_FAILED]: NAMESPACES.SYSTEM,
  [EVENTS.WORKFORCE_EXECUTION_UNCERTAIN]: NAMESPACES.SYSTEM,
  [EVENTS.BUSINESS_WORKFLOW_RECEIVED]: NAMESPACES.WORKFORCE,
  [EVENTS.BUSINESS_WORKFLOW_UNDERSTANDING]: NAMESPACES.WORKFORCE,
  [EVENTS.BUSINESS_WORKFLOW_DECISION]: NAMESPACES.WORKFORCE,
  [EVENTS.BUSINESS_WORKFLOW_APPROVAL_REQUIRED]: NAMESPACES.COUNCIL,
  [EVENTS.BUSINESS_WORKFLOW_EXECUTING]: NAMESPACES.WORKFORCE,
  [EVENTS.BUSINESS_WORKFLOW_SUCCEEDED]: NAMESPACES.WORKFORCE,
  [EVENTS.BUSINESS_WORKFLOW_FAILED]: NAMESPACES.SYSTEM,
  [EVENTS.BUSINESS_WORKFLOW_UNCERTAIN]: NAMESPACES.SYSTEM,
  [EVENTS.BUSINESS_WORKFLOW_CANCELLED]: NAMESPACES.WORKFORCE,
});

module.exports = {
  EVENTS,
  NAMESPACES,
  EVENT_NAMESPACE,
  ALIASES_TO_CANONICAL,
  canonicalEventName,
};
