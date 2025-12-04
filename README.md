# 广工迎新智能助手 - 后端服务与插件扩展

## 📖 项目简介
本项目是“广工迎新智能助手”的后端扩展模块。为了突破平台原生能力的限制，实现了**基于 Serverless 的数据持久化存储**和**自定义插件扩展**。

## 🚀 二开功能亮点
**未知问题自动捕获系统**：
* **架构**：Agent -> Custom Plugin -> Aliyun FC (Python Flask) -> RDS MySQL。
* **功能**：当智能体无法回答用户问题时，自动触发兜底逻辑，将问题实时写入云数据库，形成反馈闭环。

## 🛠️ 技术栈
* **Compute**: 阿里云函数计算 (FC) / Python 3.9
* **Database**: 阿里云 RDS MySQL
* **Protocol**: OpenAPI / Swagger
* **Framework**: Flask, PyMySQL
* **Tool**: DataGrip

## 📂 目录说明
* `/cloud_function`: 云函数核心业务逻辑代码。
* `/plugins`: 智能体自定义工具的 OpenAPI 定义文件。
