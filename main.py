# main.py - 终极防504版 (加入立即响应机制)
from flask import Flask, request, jsonify, Response
import requests
import json
import uuid
# ❌ 确保没有 flask_cors
from qcloud_cos import CosConfig, CosS3Client
from tencentcloud.common import credential
from tencentcloud.lke.v20231130 import lke_client, models
import re # 引入正则处理思考标签

app = Flask(__name__)

# ================= 配置区 =================
SECRET_ID = "xxxxxx" #密钥
SECRET_KEY = "xxxx"  #密钥信息
BOT_BIZ_ID = "xxxxx"      #APP信息
BOT_APP_KEY = "xxxxxxx"   #APP信息
LKE_SSE_URL = "https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse"
# ===========================================

# 1. 上传图片到 COS (保持不变)
def upload_image_to_cos(file_storage):
    try:
        cred = credential.Credential(SECRET_ID, SECRET_KEY)
        client = lke_client.LkeClient(cred, "ap-guangzhou")
        ext = file_storage.filename.split('.')[-1].lower()
        if ext == 'jpg': ext = 'jpeg'
        req = models.DescribeStorageCredentialRequest()
        req.BotBizId = BOT_BIZ_ID
        req.FileType = ext
        req.IsPublic = True
        req.TypeKey = "realtime"
        resp = client.DescribeStorageCredential(req)
        cred_info = resp.Credentials
        config = CosConfig(Region=resp.Region, SecretId=cred_info.TmpSecretId, SecretKey=cred_info.TmpSecretKey, Token=cred_info.Token, Scheme='https')
        cos_client = CosS3Client(config)
        file_content = file_storage.read()
        file_storage.seek(0)
        cos_client.put_object(Bucket=resp.Bucket, Body=file_content, Key=resp.UploadPath, EnableMD5=False)
        return f"https://{resp.Bucket}.cos.{resp.Region}.myqcloud.com{resp.UploadPath}"
    except Exception as e:
        print(f"上传报错: {e}")
        return None

# 2. 上传接口
@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    img_url = upload_image_to_cos(file)
    if img_url: return jsonify({"url": img_url})
    else: return jsonify({"error": "Upload failed"}), 500

# 3. 🔥 核心对话接口
@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_input = data.get('content', '')
    session_id = data.get('session_id') or str(uuid.uuid4())
    request_id = str(uuid.uuid4())
    visitor_id = "user_" + session_id[-8:]

    payload = {
        "bot_app_key": BOT_APP_KEY,
        "request_id": request_id,
        "session_id": session_id,
        "visitor_biz_id": visitor_id,
        "stream": "enable", 
        "file_infos": [],
        "incremental": True,  # 增量模式，防止重复
        "content": user_input 
    }

    print(f"[{session_id}] 请求开始: {user_input}")

    def generate():
        try:
            #核心修改：抢跑策略
            # 在请求 LKE 之前，先发一个空包给小程序。
            # 这会让 HTTP 状态码立刻变成 200 OK，建立长连接，
            # 彻底骗过网关的 60s 超时检测。
            yield json.dumps({"content": ""}) + "\n"

            # ----------------------------------------
            
            # 然后再慢慢请求 LKE
            response = requests.post(LKE_SSE_URL, json=payload, stream=True, timeout=120)
            
            for line in response.iter_lines():
                if not line: continue
                decoded_line = line.decode('utf-8')
                
                if decoded_line.startswith("data:"):
                    json_str = decoded_line.replace("data:", "").strip()
                    try:
                        data_obj = json.loads(json_str)
                        msg_type = data_obj.get("type")
                        
                        if msg_type == "reply":
                            payload_data = data_obj.get("payload", {})
                            if not payload_data.get("is_from_self", False):
                                content = payload_data.get("content", "")
                                # 再次清洗 <think> 标签，防止流式输出思考过程
                                content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL)
                                if content:
                                    yield json.dumps({"content": content}) + "\n"
                                    
                        elif msg_type == "error":
                            err_msg = data_obj.get("error", {}).get("message", "Error")
                            # 忽略非致命错误
                            if "超时" not in err_msg:
                                yield json.dumps({"error": err_msg}) + "\n"
                            
                    except: pass
        except Exception as e:
            print(f"流式中断: {e}")
            yield json.dumps({"error": str(e)}) + "\n"

    return Response(generate(), mimetype='application/json')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=True)