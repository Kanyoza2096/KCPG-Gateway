'use strict';

/**
 * Event names: KCPG canonical + Python core aliases.
 * Python UnifiedEventBus / organism filters use names like director.proposal,
 * council.decided, post.published, heartbeat.beat — map both ways in the bridge.
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
  OPERATOR_TASK_CREATED: 'operator.task.created',
  RELIABILITY_ESCALATION: 'reliability.escalation',
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
  REFLEX_FIRED: 'reflex.fired',
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
});

function canonicalEventName(type) {
  if (!type) return type;
  return ALIASES_TO_CANONICAL[type] || type;
}

const NAMESPACES = Object.freeze({
  DASHBOARD: '/dashboard',
  SYSTEM: '/system',
  COUNCIL: '/council',
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
  [EVENTS.OPERATOR_TASK_CREATED]: NAMESPACES.DASHBOARD,
  [EVENTS.RELIABILITY_ESCALATION]: NAMESPACES.SYSTEM,
  [EVENTS.PUBLISH_COMPLETED]: NAMESPACES.DASHBOARD,
  [EVENTS.POST_PUBLISHED]: NAMESPACES.DASHBOARD,
  [EVENTS.COMMAND_RESULT]: NAMESPACES.DASHBOARD,
});

module.exports = {
  EVENTS,
  NAMESPACES,
  EVENT_NAMESPACE,
  ALIASES_TO_CANONICAL,
  canonicalEventName,
};
