-- migration: create draft_events table
CREATE TABLE IF NOT EXISTS draft_events (
  draft_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255),
  start_time DATETIME NULL,
  end_time DATETIME NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  category_id INT NULL,
  submitted_by BIGINT NOT NULL,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status ENUM('draft','submitted','approved','rejected') DEFAULT 'draft',
  attachments JSON NULL,
  review_notes TEXT NULL
);
