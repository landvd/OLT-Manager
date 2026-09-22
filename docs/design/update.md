# 桌面手动增量更新协议

因不再依赖双岗旁路由的登录状态，当前客户端取消启动后的网络自动检查和自动更新服务，改为人工携带增量包，在“系统更新”页面选择本地 `latest.json`。

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

手动流程：解压增量包 → 打开“系统更新”→ 选择 `latest.json` → 等待校验通过 → 人工确认安装 → 重新打开 OLT Manager。更新包应与目标版本匹配，并保留完整整体包作为回退方案。
