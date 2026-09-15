<template>
  <view v-if="visible" class="gate">
    <view class="card">
      <text class="title">How AI Processing Works</text>
      <text class="body">
        PiggyNotebook uses third-party AI services to process what you record, powering automatic classification, summaries, and voice-to-text:
      </text>
      <view class="vendor-list">
        <view class="vendor-item">
          <text class="vendor-name">Baidu Qianfan / ERNIE</text>
          <text class="vendor-desc">Sent: your typed or transcribed text fragments — used to auto-classify into topics, generate topic summaries, and answer your questions</text>
        </view>
        <view class="vendor-item">
          <text class="vendor-name">Volcengine (Doubao) Speech Recognition</text>
          <text class="vendor-desc">Sent: your voice recordings — used to convert speech to text</text>
        </view>
      </view>
      <text class="body">
        This content is sent to the respective provider in real time to generate results; we don't keep our own long-term copy. See our
        <text class="link" @click="openPrivacyPolicy">Privacy Policy</text> for details.
      </text>
      <text class="body small">
        Since capturing notes, voice-to-text, and automatic organization are this app's core features, you need to agree before using it.
      </text>

      <view class="actions">
        <view class="btn secondary" @click="decline">
          <text>Decline (Exit)</text>
        </view>
        <view class="btn primary" @click="agree">
          <text>Agree &amp; Continue</text>
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
        title: 'Agreement Required',
        content: 'Declining means you can\'t use this app\'s core features — the app will now exit.',
        showCancel: true,
        cancelText: 'Back',
        confirmText: 'Exit',
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
