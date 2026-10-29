'use strict';

const SECTION_DEFINITIONS = Object.freeze({
  businessHealth: { authority: 'observed', sourceKeys: ['systemHealth', 'deepHealth', 'status', 'organismVitals', 'guardian', 'slo'] },
  objectives: { authority: 'business_operating_layer', sourceKeys: ['businessAutomation', 'workflow', 'predictions'] },
  opportunities: { authority: 'business_intelligence', sourceKeys: ['predictions', 'analytics', 'businessAutomation'] },
  risks: { authority: 'governance_and_observed_runtime', sourceKeys: ['guardian', 'alerts', 'slo', 'workflow'] },
  decisions: { authority: 'governance', sourceKeys: ['council', 'events', 'workflow'] },
  workforce: { authority: 'governed_workforce', sourceKeys: ['workflow', 'events', 'guardian'] },
  operations: { authority: 'business_operating_layer', sourceKeys: ['workflow', 'services', 'metricsResources', 'integrations'] },
  outcomes: { authority: 'outcome_measurement', sourceKeys: ['analytics', 'predictions', 'events'] },
  evidence: { authority: 'evidence_plane', sourceKeys: ['events', 'audit', 'analytics', 'slo'] },
  governance: { authority: 'governance', sourceKeys: ['guardian', 'council', 'workflow', 'autonomy'] },
});

const SECTION_STATES = Object.freeze(['LIVE', 'DEGRADED', 'UNKNOWN']);
const DATA_CLASSES = Object.freeze(['OBSERVED', 'DERIVED', 'UNAVAILABLE']);

function contract() {
  return {
    schema: 'CommandCenterTruthContract/v1',
    generatedAt: new Date().toISOString(),
    workspaceScoped: true,
    browserBoundary: 'KCPG_GATEWAY',
    consequentialCommandPath: [
      'KCPG_GATEWAY', 'GOVERNANCE', 'ACTION_KERNEL', 'DURABLE_OUTBOX', 'CONNECTOR_PROVIDER', 'RECONCILIATION'
    ],
    sectionStates: [...SECTION_STATES],
    dataClasses: [...DATA_CLASSES],
    sections: Object.fromEntries(Object.entries(SECTION_DEFINITIONS).map(([key, value]) => [key, {
      ...value,
      freshnessRequired: true,
      evidenceRequired: true,
      confidenceRequired: true,
      actionAuthorityGranted: false,
    }])),
  };
}

module.exports = { SECTION_DEFINITIONS, SECTION_STATES, DATA_CLASSES, contract };
