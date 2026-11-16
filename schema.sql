-- TodoLister Database Schema
-- Run: mysql -u root -p todolister < schema.sql

SET NAMES utf8mb4;
SET foreign_key_checks = 0;

-- --------------------------------------------------------
-- Projects
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `projects` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`        VARCHAR(120)  NOT NULL,
  `description` TEXT,
  `repo_url`    VARCHAR(500),
  `status`      ENUM('in_dev','to_fix','in_prod','paused','archived') NOT NULL DEFAULT 'in_dev',
  `visibility`  ENUM('private','public') NOT NULL DEFAULT 'private',
  `share_password_hash` VARCHAR(255) DEFAULT NULL,
  `guest_permission` ENUM('observer','card_mover','editor') NOT NULL DEFAULT 'observer',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Kanban Categories (Backend / Frontend / Other + custom)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `categories` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `name`       VARCHAR(80)  NOT NULL,
  `color`      VARCHAR(20)  NOT NULL DEFAULT '#00ff88',
  `position`   INT          NOT NULL DEFAULT 0,
  `hidden`     TINYINT(1)   NOT NULL DEFAULT 0,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Kanban Statuses (Idea / To Develop / To Fix / Done + custom)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `statuses` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `name`       VARCHAR(80)  NOT NULL,
  `color`      VARCHAR(20)  NOT NULL DEFAULT '#555',
  `position`   INT          NOT NULL DEFAULT 0,
  `hidden`     TINYINT(1)   NOT NULL DEFAULT 0,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Kanban Cards
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cards` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`  INT UNSIGNED NOT NULL,
  `category_id` INT UNSIGNED NOT NULL,
  `status_id`   INT UNSIGNED NOT NULL,
  `title`       VARCHAR(255) NOT NULL,
  `description` TEXT,
  `priority`    ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  `position`    INT          NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`project_id`)  REFERENCES `projects`(`id`)   ON DELETE CASCADE,
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`status_id`)   REFERENCES `statuses`(`id`)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Notes (one rich notepad per project)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notes` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL UNIQUE,
  `content`    LONGTEXT,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Guest Sessions (public project access)
-- session_token holds a SHA-256 of the cookie value, never the raw token.
-- The effective permission is projects.guest_permission; `permission` here
-- only records the level granted when the session was opened.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `guest_sessions` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`   INT UNSIGNED NOT NULL,
  `session_token` VARCHAR(255) NOT NULL UNIQUE,
  `permission`   ENUM('observer','card_mover','editor') NOT NULL DEFAULT 'observer',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   DATETIME NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET foreign_key_checks = 1;
