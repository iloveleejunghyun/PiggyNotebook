<template>
  <view v-if="visible" class="gate">
    <view class="card">
      <text class="title">AI 处理说明</text>
      <text class="body">
        PiggyNotebook 使用第三方 AI 服务处理你的记录内容，以提供自动分类、汇总和语音转文字功能：
      </text>
      <view class="vendor-list">
        <view class="vendor-item">
          <text class="vendor-name">百度智能云 千帆 / 文心一言</text>
          <text class="vendor-desc">发送内容：你输入或转写后的文字碎片 — 用于自动归类到主题、生成主题汇总、回答你的问题</text>
        </view>
        <view class="vendor-item">
          <text class="vendor-name">火山引擎（豆包）语音识别</text>
          <text class="vendor-desc">发送内容：你的语音录音 — 用于将语音转换为文字</text>
        </view>
      </view>
      <text class="body">
        这些内容会实时发送给对应服务商用于生成结果，我们自己不会长期留存副本。详见
        <text class="link" @click="openPrivacyPolicy">隐私政策</text>。
      </text>
      <text class="body small">
        由于记录、语音转文字和自动整理是本应用的核心功能，需要同意后才能使用。
      </text>

      <view class="actions">
        <view class="btn secondary" @click="decline">
          <text>不同意（退出）</text>
        </view>
        <view class="btn primary" @click="agree">
          <text>同意并继续</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getAIConsent, setAIConsent } from '@/utils/storage.js'

export default {
  name: 'AiConsentGate',
  data() {
    return {
      visible: false
    }
  },
  mounted() {
    this.visible = !getAIConsent()
  },
  methods: {
    agree() {
      setAIConsent(true)
      this.visible = false
      this.$emit('agreed')
    },
    decline() {
      // Capture/AI processing is the entire product — without consent there's
      // nothing left the app can honestly do, so exit rather than leave a
      // half-functional app or (worse) silently proceeding without consent.
      uni.showModal({
        title: '需要同意才能使用',
        content: '不同意将无法使用本应用的核心功能，App 即将退出。',
        showCancel: true,
        cancelText: '返回',
        confirmText: '退出',
        success: res => {
          if (res.confirm && typeof plus !== 'undefined' && plus.runtime) {
            plus.runtime.quit()
          }
        }
      })
    },
    openPrivacyPolicy() {
      // eslint-disable-next-line no-undef
      plus.runtime.openURL('https://piggy-download.ai12.ai/privacy-policy.html')
    }
  }
}
</script>

<style scoped>
.gate {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 48rpx;
  box-sizing: border-box;
}
.card {
  background: #fff;
  border-radius: 20rpx;
  padding: 40rpx 32rpx;
  max-height: 85vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 34rpx;
  font-weight: 600;
  color: #222;
  margin-bottom: 20rpx;
  text-align: center;
}
.body {
  font-size: 26rpx;
  color: #444;
  line-height: 1.6;
  margin-bottom: 20rpx;
}
.body.small {
  font-size: 23rpx;
  color: #999;
}
.vendor-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.vendor-item {
  background: #FFF7ED;
  border-left: 4rpx solid #F97316;
  border-radius: 8rpx;
  padding: 16rpx 20rpx;
}
.vendor-name {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #F97316;
  margin-bottom: 6rpx;
}
.vendor-desc {
  display: block;
  font-size: 23rpx;
  color: #555;
  line-height: 1.5;
}
.link {
  color: #F97316;
  text-decoration: underline;
}
.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 12rpx;
}
.btn {
  flex: 1;
  text-align: center;
  padding: 20rpx 0;
  border-radius: 12rpx;
  font-size: 27rpx;
}
.btn.secondary {
  background: #F5F5F5;
  color: #999;
}
.btn.primary {
  background: #F97316;
  color: #fff;
}
</style>
