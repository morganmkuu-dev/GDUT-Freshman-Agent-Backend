# -*- coding: utf-8 -*-
from flask import Flask, request, jsonify
import pymysql
import json
import time

app = Flask(__name__)

# ================= 数据库配置 =================
DB_CONFIG = {
    # ⚠️ 请确保这里填的是你 RDS 的【内网地址】
    # 如果函数和数据库不在同一个 VPC，这里是连不上的
    "host": "rm-cn-em94jtxe50001t.rwlb.rds.aliyuncs.com", 
    "port": 3306,
    "user": "testuser",
    "password": "AbC8706111@",
    "database": "gdut_agent",
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor
}
# ============================================

@app.route('/', methods=['POST', 'GET'])
@app.route('/record', methods=['POST', 'GET'])
def home():
    # 这是一个心跳检测，用于浏览器直接访问测试
    if request.method == 'GET':
        return jsonify({"status": "success", "message": "云函数服务正在运行中..."})
    
    # 下面是处理 POST 请求的逻辑
    try:
        # 1. 获取数据
        body = request.json or {}
        user_question = body.get("question", "")
        user_id = body.get("user_id", "Unknown")

        if not user_question:
            return jsonify({"status": "error", "message": "问题不能为空"}), 400

        # 2. 写入数据库
        conn = pymysql.connect(**DB_CONFIG)
        try:
            with conn.cursor() as cursor:
                sql = "INSERT INTO unanswered_questions (user_id, question, created_at, status) VALUES (%s, %s, %s, %s)"
                current_time = time.strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute(sql, (user_id, user_question, current_time, 'pending'))
            conn.commit()
        finally:
            conn.close()

        return jsonify({"status": "success", "message": "已记录"})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ⚠️ 关键：监听 0.0.0.0 和 9000 端口，对应你的配置截图
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=9000)