# 桌面更新协议

有两条路径，增量包格式相同：启动自动更新（决定见 ADR-093）和手动增量包（备用）。

## 启动自动更新

服务器上放 `channel.json` 和增量包 ZIP，由 `node scripts/publish-update.mjs --zip <增量包.zip>` 发布；连接信息在发布机 `~/.config/olt-manager/publish.json`，不进仓库。

```json
{
  "payload": "{\"format\":\"olt-manager/update-channel/v1\",\"version\":\"1.3.26\",\"file\":\"OLT-Manager-1.3.26-incremental.zip\",\"size\":123,\"sha256\":\"...\",\"bases\":[\"1.3.25\"],\"targets\":[\"win32-x64\"]}",
  "signature": "payload 的 Ed25519 签名（base64）"
}
```

客户端在“系统更新”页填写服务器地址（留空即关闭，存于用户数据目录的 `update-settings.json`）。启动流程：查 `channel.json` 并验签 → 版本更高且本机在 `bases` 内 → 下载 ZIP 并校验 → 走下面相同的暂存校验 → 更新进程替换文件、拉起新版本、等待确认 → 超时或退出则恢复旧文件并跳过该版本。任何一步失败都继续用当前版本启动。

## 手动增量包

人工携带增量包，在“系统更新”页面选择 ZIP 或 `latest.json`。

选择后，客户端只读取与 `latest.json` 同目录的文件，校验清单、大小和 SHA-256；用户确认后才关闭主程序并替换程序文件。

## 清单格式

清单格式为 `olt-manager/update/v1`。手动增量包至少包含 `latest.json` 和清单中列出的相对路径文件。`mode: incremental` 的 `baseVersion` 必须等于本机版本。

```json
{
  "format": "olt-manager/update/v1",
  "version": "1.2.0",
  "artifacts": [
    {
      "platform": "win32",
      "arch": "x64",
      "mode": "incremental",
      "baseVersion": "1.1.9",
      "files": [
        {
          "path": "electron/main.cjs",
          "size": 12345,
          "sha256": "64位小写十六进制 SHA-256"
        }
      ],
      "remove": [],
      "releaseNotes": "更新说明"
    }
  ]
}
```

`path` 相对于手动包根目录，同时也是 Electron 的 `resources/app` 相对路径；禁止绝对路径、`..` 和反斜杠路径。文件先复制到用户数据目录的更新暂存区，逐项完成大小和 SHA-256 校验后，由子进程等待主程序退出再替换；用户数据目录中的 `data/` 不在更新范围内。

手动流程：解压增量包 → 打开“系统更新”→ 选择 `latest.json` → 等待校验通过 → 人工确认安装 → 程序自动重启到新版本（新版本启动失败时自动恢复旧版本）。更新包应与目标版本匹配，并保留完整整体包作为回退方案。
