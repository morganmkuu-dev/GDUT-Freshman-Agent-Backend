const app = getApp()

// 🔥 1. 腾讯云 LKE 接口地址 (小程序直连)
const LKE_API_URL = "https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse";

// 🔥 2. 请务必替换为你的 Bot App Key
const BOT_APP_KEY = "xoIXCXRlcmHMCtRylTBltjuKeYvxPlJahdwUmUeJWtfGERtPdlfWIWGcsOEFwZdNBjlXhlROnMSAAkxBnZCFnIIYomRhZLrnuoDhVLlhxHdwQTLZEobhFbODEdkqKJJM";

// 3. 云开发环境ID (用于图片上传)
const ENV_ID = "cloud1-3g43l1ee01c91129";

Page({
  data: {
    inputValue: '',
    msgList: [],
    scrollId: '',
    isRequesting: false,
    sessionId: ''
  },

  onLoad() {
    // 初始化云开发 (用于图片上传)
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: ENV_ID,
        traceUser: true,
      })
    }

    let sid = wx.getStorageSync('my_session_id');
    if (!sid) {
      sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      wx.setStorageSync('my_session_id', sid);
    }

    const history = wx.getStorageSync('chat_history_' + sid) || [];
    this.setData({
      sessionId: sid,
      msgList: history,
      scrollId: 'bottom-anchor'
    });
  },

  saveHistory() {
    const sid = this.data.sessionId;
    const list = this.data.msgList;
    if (sid && list) wx.setStorageSync('chat_history_' + sid, list);
  },

  showClearMenu() {
    wx.showActionSheet({
      itemList: ['清空屏幕 (保留记忆)', '开启新会话 (清除记忆)'],
      success: (res) => {
        if (res.tapIndex === 0) this.clearScreenKeepSession();
        else if (res.tapIndex === 1) this.startNewSession();
      }
    })
  },

  clearScreenKeepSession() {
    this.setData({
      msgList: []
    });
    this.saveHistory();
    wx.showToast({
      title: '屏幕已清空',
      icon: 'none'
    });
  },

  startNewSession() {
    const oldSid = this.data.sessionId;
    wx.removeStorageSync('chat_history_' + oldSid);
    const newSid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    wx.setStorageSync('my_session_id', newSid);
    this.setData({
      sessionId: newSid,
      msgList: [],
      scrollId: ''
    });
    wx.showToast({
      title: '新会话已开启',
      icon: 'none'
    });
  },

  onInput(e) {
    this.setData({
      inputValue: e.detail.value
    });
  },

  sendMsg() {
    const text = this.data.inputValue.trim();
    if (this.data.isRequesting) return;
    if (!text) {
      wx.showToast({
        title: '请输入内容',
        icon: 'none'
      });
      return;
    }

    this.addMessage('user', 'text', text);
    this.setData({
      inputValue: ''
    });
    this.addMessage('assistant', 'text', '思考中...', true);

    // 直连 LKE 发送文本
    this.callLkeDirectly(text);
  },

  // 🔥 保持原有的云开发图片上传逻辑
  chooseImage() {
    const that = this;
    if (this.data.isRequesting) return;

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success(res) {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        that.addMessage('user', 'image', tempFilePath);
        that.addMessage('assistant', 'text', '正在上传...', true);

        // 1. 上传到云存储
        const cloudPath = 'uploads/' + Date.now() + '-' + Math.random().toString(36).substr(2) + '.jpg';

        wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath,
          success: res => {
            // 2. 获取图片的公网 URL
            wx.cloud.getTempFileURL({
              fileList: [res.fileID],
              success: fileRes => {
                const imgUrl = fileRes.fileList[0].tempFileURL;
                console.log("图片链接获取成功:", imgUrl);
                that.updateLoadingText('正在分析...');

                // 3. 把 URL 当作文本，直连发给 LKE
                that.callLkeDirectly(imgUrl);
              },
              fail: console.error
            })
          },
          fail: err => {
            console.error(err);
            that.updateErrorMsg("上传失败");
          }
        })
      }
    });
  },

  // 🔥🔥🔥 核心修复：直连 LKE + 缓冲区处理 (解决显示不全) 🔥🔥🔥
  callLkeDirectly(content) {
    const that = this;
    const requestId = 'req_' + Date.now() + Math.random().toString(36).substr(2);
    const visitorId = "user_" + that.data.sessionId.substr(-8);

    // 构造 LKE 标准 Payload
    let payload = {
      "bot_app_key": BOT_APP_KEY,
      "request_id": requestId,
      "session_id": that.data.sessionId,
      "visitor_biz_id": visitorId,
      "stream": "enable", // 开启流式
      "file_infos": [],
      "incremental": true, // 增量模式，防止重复
      "content": content
    };

    const requestTask = wx.request({
      url: LKE_API_URL,
      method: 'POST',
      enableChunked: true, // 小程序开启流式接收
      data: payload,
      header: {
        'content-type': 'application/json'
      },
      success: (res) => {
        console.log("LKE 连接成功");
      },
      fail: (err) => {
        console.error("LKE 连接失败", err);
        that.updateErrorMsg("网络请求失败");
      }
    });

    // 定义缓冲区，防止 JSON 被截断
    let lineBuffer = '';

    // 监听流式数据
    requestTask.onChunkReceived((res) => {
      // 1. 安全解码数据包
      let chunk = "";
      if (res.data instanceof ArrayBuffer) {
        let uint8 = new Uint8Array(res.data);
        // 分片处理防止栈溢出
        const CHUNK_SIZE = 0x8000;
        for (let i = 0; i < uint8.length; i += CHUNK_SIZE) {
          chunk += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK_SIZE));
        }
      }

      try {
        chunk = decodeURIComponent(escape(chunk));
      } catch (e) {
        // 如果这里报错，通常是因为多字节字符被切断，暂存到 buffer 等待下一次拼接
      }

      // 2. 拼接到缓冲区
      lineBuffer += chunk;

      // 3. 逐行处理 (LKE 的 SSE 格式以 \n 分隔)
      while (lineBuffer.indexOf('\n') !== -1) {
        const index = lineBuffer.indexOf('\n');
        // 取出一行完整数据
        let line = lineBuffer.substring(0, index).trim();
        // 剩下的放回缓冲区
        lineBuffer = lineBuffer.substring(index + 1);

        if (line.startsWith('data:')) {
          try {
            const jsonStr = line.substring(5).trim(); // 去掉 "data:"
            if (!jsonStr) continue;

            const data = JSON.parse(jsonStr);

            // 处理回复
            if (data.type === 'reply') {
              const payload = data.payload || {};
              if (!payload.is_from_self) {
                const content = payload.content || '';
                if (content) {
                  that.appendStreamContent(content);
                }
              }
            }
            // 处理错误 (可选)
            else if (data.type === 'error') {
              console.warn("LKE Error:", data);
            }

          } catch (e) {
            // 如果 JSON 解析失败，说明这一行数据有问题，忽略即可，不中断
            console.log("Parse Error:", e);
          }
        }
      }
    });
  },

  appendStreamContent(chunk) {
    const msgList = this.data.msgList;
    const lastMsg = msgList[msgList.length - 1];

    if (lastMsg.loading) {
      lastMsg.content = '';
      lastMsg.loading = false;
      this.setData({
        isRequesting: false
      });
    }

    lastMsg.content += chunk;
    this.setData({
      msgList,
      scrollId: 'bottom-anchor'
    });
    this.saveHistory();
  },

  addMessage(role, type, content, loading = false) {
    const msgList = this.data.msgList;
    msgList.push({
      role,
      type,
      content,
      loading
    });
    this.setData({
      msgList,
      scrollId: 'bottom-anchor',
      isRequesting: loading
    });
    this.saveHistory();
  },

  updateErrorMsg(msg) {
    const msgList = this.data.msgList;
    const lastMsg = msgList[msgList.length - 1];
    if (lastMsg) {
      lastMsg.content = msg;
      lastMsg.loading = false;
      this.setData({
        msgList,
        isRequesting: false
      });
      this.saveHistory();
    }
  },

  updateLoadingText(text) {
    const msgList = this.data.msgList;
    const lastMsg = msgList[msgList.length - 1];
    if (lastMsg && lastMsg.loading) {
      lastMsg.content = text;
      this.setData({
        msgList
      });
    }
  },

  // 即使没收到流，也要能清除状态
  clearLoadingText() {
    const msgList = this.data.msgList;
    const lastMsg = msgList[msgList.length - 1];

    if (lastMsg && lastMsg.loading) {
      lastMsg.content = '';
      lastMsg.loading = false;
    }

    this.setData({
      msgList,
      isRequesting: false
    });
    this.saveHistory();
  },

  previewImg(e) {
    wx.previewImage({
      urls: [e.currentTarget.dataset.src]
    });
  }
});