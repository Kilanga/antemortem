/**
 * Antemortem — Forge SQL schema.
 *
 * Rules (see BUILD.md §5 and Forge SQL docs):
 *  - Every statement is idempotent (CREATE TABLE IF NOT EXISTS). The migration
 *    runner also tracks what ran per installation, but idempotency is a second
 *    safety net because migrations can be retried after a DDL rate-limit error.
 *  - Append-only. Never edit a migration that has shipped; add a new one.
 *  - No foreign keys (Forge SQL does not support them); relations are plain
 *    columns + indexes, and deletes are logical (archived_at).
 *  - No AUTO_INCREMENT (TiDB hotspots). Ids are CHAR(36) UUIDs generated in code.
 *  - JSON columns hold structured evidence; MySQL JSON type is supported.
 *
 * Each entry: { name, statement }. Names are the migration keys stored by Forge.
 */

const common = `
  id CHAR(36) NOT NULL PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL`;

export const migrations = [
  {
    name: 'v001_contract',
    statement: `CREATE TABLE IF NOT EXISTS contract (${common},
      name VARCHAR(255) NOT NULL,
      counterparty VARCHAR(255) NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      confluence_page_id VARCHAR(64) NULL,
      notes TEXT NULL,
      is_demo TINYINT(1) NOT NULL DEFAULT 0
    )`,
  },
  {
    name: 'v002_obligation',
    statement: `CREATE TABLE IF NOT EXISTS obligation (${common},
      contract_id CHAR(36) NOT NULL,
      code VARCHAR(32) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      metric_type VARCHAR(32) NOT NULL,
      jql_scope TEXT NULL,
      sla_hours DECIMAL(8,2) NULL,
      threshold DECIMAL(8,4) NULL,
      period VARCHAR(16) NOT NULL DEFAULT 'monthly',
      penalty_type VARCHAR(32) NULL,
      penalty_value DECIMAL(14,2) NULL,
      invoice_basis DECIMAL(14,2) NULL,
      owner_account_id VARCHAR(128) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      INDEX idx_obligation_contract (contract_id),
      INDEX idx_obligation_status (status)
    )`,
  },
  {
    name: 'v003_decision',
    statement: `CREATE TABLE IF NOT EXISTS decision (${common},
      title VARCHAR(255) NOT NULL,
      statement TEXT NOT NULL,
      rationale TEXT NULL,
      decided_at DATETIME NULL,
      decided_by JSON NULL,
      source_type VARCHAR(32) NULL,
      source_id VARCHAR(128) NULL,
      source_url VARCHAR(1024) NULL,
      alternatives_rejected JSON NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      INDEX idx_decision_status (status)
    )`,
  },
  {
    name: 'v004_assumption',
    statement: `CREATE TABLE IF NOT EXISTS assumption (${common},
      decision_id CHAR(36) NOT NULL,
      statement TEXT NOT NULL,
      kind VARCHAR(32) NOT NULL,
      params JSON NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'holding',
      last_checked_at DATETIME NULL,
      evidence JSON NULL,
      INDEX idx_assumption_decision (decision_id),
      INDEX idx_assumption_status (status)
    )`,
  },
  {
    name: 'v005_link',
    statement: `CREATE TABLE IF NOT EXISTS link (${common},
      from_type VARCHAR(32) NOT NULL,
      from_id VARCHAR(128) NOT NULL,
      to_type VARCHAR(32) NOT NULL,
      to_id VARCHAR(128) NOT NULL,
      relation VARCHAR(32) NOT NULL,
      origin VARCHAR(16) NOT NULL DEFAULT 'user',
      confidence DECIMAL(4,3) NOT NULL DEFAULT 1.000,
      INDEX idx_link_from (from_type, from_id),
      INDEX idx_link_to (to_type, to_id),
      UNIQUE KEY uq_link (from_type, from_id, relation, to_type, to_id)
    )`,
  },
  {
    name: 'v006_risk_signal',
    statement: `CREATE TABLE IF NOT EXISTS risk_signal (${common},
      type VARCHAR(48) NOT NULL,
      severity TINYINT NOT NULL DEFAULT 3,
      subject_type VARCHAR(32) NOT NULL,
      subject_id VARCHAR(128) NOT NULL,
      fingerprint VARCHAR(191) NOT NULL,
      detected_at DATETIME NOT NULL,
      resolved_at DATETIME NULL,
      evidence JSON NULL,
      UNIQUE KEY uq_signal_fingerprint (fingerprint),
      INDEX idx_signal_subject (subject_type, subject_id),
      INDEX idx_signal_open (resolved_at)
    )`,
  },
  {
    name: 'v007_forecast',
    statement: `CREATE TABLE IF NOT EXISTS forecast (${common},
      obligation_id CHAR(36) NOT NULL,
      projected_breach_date DATE NULL,
      probability DECIMAL(4,3) NOT NULL,
      projected_cost DECIMAL(14,2) NULL,
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      chain JSON NULL,
      explanation JSON NULL,
      computed_at DATETIME NOT NULL,
      superseded_by CHAR(36) NULL,
      INDEX idx_forecast_obligation (obligation_id, computed_at)
    )`,
  },
  {
    name: 'v008_future_incident',
    statement: `CREATE TABLE IF NOT EXISTS future_incident (${common},
      forecast_id CHAR(36) NOT NULL,
      obligation_id CHAR(36) NOT NULL,
      title VARCHAR(255) NOT NULL,
      incident_date DATE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'draft',
      confluence_page_id VARCHAR(64) NULL,
      confluence_page_url VARCHAR(1024) NULL,
      version INT NOT NULL DEFAULT 1,
      summary TEXT NULL,
      impact_statement TEXT NULL,
      root_cause TEXT NULL,
      timeline JSON NULL,
      contributing_factors JSON NULL,
      actions JSON NULL,
      averted_at DATETIME NULL,
      cost_avoided DECIMAL(14,2) NULL,
      materialized_at DATETIME NULL,
      dismissed_reason TEXT NULL,
      INDEX idx_fi_status (status),
      INDEX idx_fi_obligation (obligation_id)
    )`,
  },
  {
    name: 'v009_action_item',
    statement: `CREATE TABLE IF NOT EXISTS action_item (${common},
      future_incident_id CHAR(36) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      issue_key VARCHAR(32) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      prevents_signal_types JSON NULL,
      INDEX idx_action_incident (future_incident_id),
      INDEX idx_action_issue (issue_key)
    )`,
  },
  {
    // Local availability table used by RestGraphSource when Teamwork Graph
    // (calendar data) is not available. Populated by the demo scenario and,
    // later, by a small form in Settings.
    name: 'v010_availability',
    statement: `CREATE TABLE IF NOT EXISTS availability (${common},
      account_id VARCHAR(128) NOT NULL,
      display_name VARCHAR(255) NULL,
      kind VARCHAR(16) NOT NULL DEFAULT 'absent',
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      note VARCHAR(255) NULL,
      INDEX idx_availability_account (account_id, starts_on)
    )`,
  },
  {
    // One row per analysis run — gives the command center a "last analysed"
    // timestamp and a place to surface engine errors without digging in logs.
    name: 'v011_analysis_run',
    statement: `CREATE TABLE IF NOT EXISTS analysis_run (${common},
      trigger_source VARCHAR(16) NOT NULL,
      started_at DATETIME NOT NULL,
      finished_at DATETIME NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'running',
      summary JSON NULL,
      error TEXT NULL,
      INDEX idx_run_started (started_at)
    )`,
  },
  {
    // Obligations measured over a contractual window rather than a calendar
    // month (common in field-service contracts: "30 days from go-live").
    // When set, the engine uses these instead of deriving the period.
    name: 'v012_obligation_period_window',
    statement: `ALTER TABLE obligation
      ADD COLUMN IF NOT EXISTS period_starts_on DATE NULL,
      ADD COLUMN IF NOT EXISTS period_ends_on DATE NULL`,
  },
  {
    // Jira Service Management SLA field used as the measure (metric_type jsm_sla).
    name: 'v013_obligation_sla_name',
    statement: `ALTER TABLE obligation ADD COLUMN IF NOT EXISTS sla_name VARCHAR(255) NULL`,
  },
];

/** Table names, in creation order — used by the health check. */
export const tableNames = [
  'contract',
  'obligation',
  'decision',
  'assumption',
  'link',
  'risk_signal',
  'forecast',
  'future_incident',
  'action_item',
  'availability',
  'analysis_run',
];
