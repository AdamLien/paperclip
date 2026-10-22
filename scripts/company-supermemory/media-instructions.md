<!-- mcrew-media:start -->
## 影片下載、逐字稿與語音（.71）

- `/usr/local/bin/crew-media` 已在 .71 安裝，可在既有公司隔離沙箱執行；共用唯讀工具與 Whisper 模型，成果只放目前自己的工作目錄。
- 先確認使用者有完整轉錄／改作授權。下載：`rtk proxy crew-media download https://www.youtube.com/watch?v=VIDEO_ID --output 新目錄`。轉錄自己的影片：`rtk proxy crew-media transcribe 相對路徑/video.mp4 --output 新目錄`。
- 完整流程：`rtk proxy crew-media process https://www.youtube.com/watch?v=VIDEO_ID --output 新目錄 --allow-online-tts`。語音單獨產生：`rtk proxy crew-media speak 相對路徑/transcript.txt --output 新目錄 --allow-online-tts`。
- Whisper 在本機 CPU 執行，輸出繁中 TXT/SRT/VTT，屬於 ASR 草稿，不能宣稱人工校對完成。語音使用 Microsoft Edge 線上 TTS 的通用台灣女聲，會傳送文字給 Microsoft；必須確認這項傳送已獲授權才加入 `--allow-online-tts`，不得傳送其他公司或未授權私人內容，也不是原講者聲音複製。
- 輸出目錄必須不存在，禁止覆蓋既有成果。下載僅支援公開 HTTPS YouTube；不借用其他人的 Cookie、帳號或 Mac 檔案。其他輸入先使用既有合法取得的檔案。
- 交付前檢查 manifest、字幕範圍及檔案非空。使用本機 paperclip skill 的 `scripts/paperclip-upload-artifact.sh`，依目前 run/chat context 上傳實際 MP4、逐字稿、MP3 與 ZIP；工作目錄路徑不代表使用者能下載。
- 不為媒體工作另開未隔離 runner、不擴大檔案掛載，也不混用其他公司成果。
<!-- mcrew-media:end -->
