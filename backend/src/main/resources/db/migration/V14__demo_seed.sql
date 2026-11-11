CREATE TABLE campus_demo_seed (
    scenario text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT current_timestamp
);
