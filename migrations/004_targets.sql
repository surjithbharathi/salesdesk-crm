-- Daily goals for the scorecard. scope 'default' applies to everyone; a user id overrides it for that person.
CREATE TABLE targets (
  scope TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('calls','answered','quotations')),
  value INTEGER NOT NULL CHECK (value >= 0),
  PRIMARY KEY (scope, metric)
);
INSERT INTO targets(scope,metric,value) VALUES ('default','calls',40),('default','answered',12),('default','quotations',3);
