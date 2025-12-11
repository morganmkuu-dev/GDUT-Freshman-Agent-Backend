const app = getApp()

// 🔥 已替换为您提供的公网域名
const SERVER_DOMAIN = "https://gdut-206055-4-1391106364.sh.run.tcloudbase.com";

// 您的环境 ID (保留用于云开发初始化，虽然主要请求走公网)
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
    // 1. 初始化云开发 (虽然我们用公网请求，但为了保险起见保留初始化)
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: ENV_ID,
        traceUser: true,
      })
    }

    // 2. 获取或生成 Session ID
    let sid = wx.getStorageSync('my_session_id');
    if (!sid) {
      sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      wx.setStorageSync('my_session_id', sid);
    }

    // 3. 加载历史聊天记录
    const historyKey = 'chat_history_' + sid;
    const history = wx.getStorageSync(historyKey) || [];

    this.setData({
      sessionId: sid,
      msgList: history,
      scrollId: 'bottom-anchor'
    });

    console.log("当前会话ID:", sid);
  },

  // 🔥 核心函数：保存历史记录到本地缓存
  saveHistory() {
    const sid = this.data.sessionId;
    const list = this.data.msgList;
    if (sid && list) {
      wx.setStorageSync('chat_history_' + sid, list);
    }
  },

  // 功能菜单：清空或重置
  showClearMenu() {
    wx.showActionSheet({
      itemList: ['清空屏幕 (保留记忆)', '开启新会话 (清除记忆)'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.clearScreenKeepSession();
        } else if (res.tapIndex === 1) {
          this.startNewSession();
        }
      },
      fail: (res) => {
        console.log(res.errMsg)
      }
    })
  },

  // 清空屏幕 (保留 Session)
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

  // 开启新会话 (重置 Session)
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

  // 发送文本消息
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

    this.callPythonBackend(text, 'text');
  },

  // 选择图片并上传
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

        // 🔥 使用 wx.uploadFile 直接传给公网后端
        // 这样可以绕过云开发的复杂中转，直接获取后端可用的 URL
        wx.uploadFile({
          url: `${SERVER_DOMAIN}/upload`,
          filePath: tempFilePath,
          name: 'file',
          success(uploadRes) {
            try {
              // 后端返回的是字符串 JSON，需要解析
              const data = JSON.parse(uploadRes.data);
              if (data.url) {
                console.log("上传成功:", data.url);
                that.updateLoadingText('正在分析...');
                // 把图片链接发给后端对话接口
                that.callPythonBackend(data.url, 'image');
              } else {
                that.updateErrorMsg("上传失败: " + (data.error || "未知"));
              }
            } catch (e) {
              that.updateErrorMsg("解析失败");
            }
          },
          fail(err) {
            console.error("上传错误", err);
            that.updateErrorMsg("连接失败");
          }
        });
      }
    });
  },

  // 🔥 核心请求：使用 wx.request + 流式传输 (彻底解决超时)
  callPythonBackend(content, type) {
    const that = this;

    // 无论是图片还是文本，统一放在 content 字段发送
    let requestData = {
      session_id: that.data.sessionId,
      content: content
    };

    const requestTask = wx.request({
      url: `${SERVER_DOMAIN}/chat`, // 使用公网域名
      method: 'POST',
      enableChunked: true, // 🔥 开启流式传输，收到一点数据就显示一点
      data: requestData,
      header: {
        'content-type': 'application/json'
      },
      success: (res) => {
        console.log("连接建立成功", res);
      },
      fail: (err) => {
        console.error("请求失败", err);
        that.updateErrorMsg("网络请求失败");
      }
    });

    // 监听流式数据包
    requestTask.onChunkReceived((res) => {
      const uint8Array = new Uint8Array(res.data);
      let textChunk = String.fromCharCode.apply(null, uint8Array);
      
      // 防止中文乱码的简单处理
      try {
        textChunk = decodeURIComponent(escape(textChunk));
      } catch (e) {}

      const lines = textChunk.split('\n');
      lines.forEach(line => {
        if (!line.trim()) return;
        try {
          const data = JSON.parse(line);
          if (data.error) {
            that.updateErrorMsg("错误: " + data.error);
          } else if (data.content) {
            // 🔥 关键：因为后端发的是增量(新字)，所以这里用 appendStreamContent 拼接
            that.appendStreamContent(data.content);
          }
        } catch (e) {
          // 忽略非 JSON 行
        }
      });
    });
  },

  // 辅助函数：流式追加内容
  appendStreamContent(chunk) {
    const msgList = this.data.msgList;
    const lastMsg = msgList[msgList.length - 1];

    // 如果是第一次收到内容，清空"思考中"或"正在分析..."
    if (lastMsg.loading) {
      lastMsg.content = '';
      lastMsg.loading = false;
      // 开始接收数据了，解除锁定，允许用户看的时候进行其他操作(可选)
      this.setData({
        isRequesting: false
      });
    }

    // 拼接新字
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
