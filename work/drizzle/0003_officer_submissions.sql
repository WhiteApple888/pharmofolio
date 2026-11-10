CREATE TABLE IF NOT EXISTS `assessment_officer_submissions` (
  `assessment_id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('draft', 'submitted')),
  `submitted_at` integer,
  FOREIGN KEY (`assessment_id`) REFERENCES `assessment_records` (`id`)
);
