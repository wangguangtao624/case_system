# 开发环境数据库与附件加密备份

- 快照：`20261113T124500Z`（UTC）
- 分支：`dev/v2.6.4`；代码版本：`v2.6.4-dev.1`
- 对应代码提交：`e61f8eeac78001303eb05004e50587b03e5b5220`
- 用例：2461；附件引用：7513；文件：7587
- 加密包大小：3170171452 字节；共 63 个分片。
- 每个分片不超过 48 MiB。`backup.json` 和 `SHA256SUMS` 记录完整性校验信息。
- 仓库为公开仓库，因此只保存 AES256 加密数据。恢复密钥不在本仓库，必须单独保管；丢失后无法解密。
- 快照使用 SQLite 在线备份，再复制附件并校验引用；不是暂停全部写入后的文件系统快照。
- 环境配置、JWT 签名密钥和运行缓存不在备份中。数据库内的业务记录保留在加密包里。

## 恢复

安装 Python 3 和 GnuPG，并将本目录的所有文件下载完整。推荐仅克隆开发分支当前快照，避免下载完整历史：

```bash
git clone --depth 1 --single-branch --branch dev/v2.6.4 https://github.com/wangguangtao624/case_system.git
cd case_system/backups/development/20261113T124500Z
sha256sum -c SHA256SUMS
python3 restore.py --key /安全位置/recovery-key.txt --target /新的空目录/case-restored
```

恢复脚本将验证每个分片和整个加密包，解密到目标空目录，验证所有文件 SHA-256、数据库完整性、表记录数和附件引用，再将附件路径和存储配置改为新位置，并生成新的独立 JWT 签名密钥。失败时目标目录可能包含未完成的数据，不能当作成功恢复使用；成功以 `RESTORE_COMPLETE.json` 为准。

启动相应版本的代码时，将 `APP_WORKSPACE_PATH` 指向恢复目录；其他环境配置按部署环境单独提供。脚本拒绝覆盖非空目录。生产恢复应另行进行验收和部署。

## 上传完成标志

仅当本目录出现 `UPLOAD_COMPLETE.json` 时，本次分片上传才完整；上传过程中切勿将未完成的目录当作可恢复备份。
