CREATE DATABASE IF NOT EXISTS gdut_agent;
USE gdut_agent;

CREATE TABLE IF NOT EXISTS unanswered_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) COMMENT '提问者ID',
    question TEXT COMMENT '未回答的问题',
    status VARCHAR(50) DEFAULT 'pending' COMMENT '状态',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
