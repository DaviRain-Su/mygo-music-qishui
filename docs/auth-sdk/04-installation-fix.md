# 0.2.1 安装修复规格

## 原因（已用 MyGo 0.1.7 实际 Open 复现）

`a link in the plugin: helper/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework`

MyGo 安装器无条件拒绝目录和 zip 中的符号链接，这是安全规则，不应修改或绕过。0.2.0 将 npm/Electron 依赖放在插件代码目录，导致本地目录安装失败；.gitignore 只约束 git，不能让 MyGo 跳过 node_modules。

## 修复契约

- `plugins/qishui` 只存代码、清单、文档及 lockfile，不含 node_modules / Electron / SDK cache / 会话。
- npm 与 Electron 安装到 `plugin-data/qishui/sdk-runtime/<依赖清单摘要>-<platform>-<arch>/`。认证目录 `plugin-data/qishui/auth-sdk` 保持不变，不清理已有登录。
- 依赖清单摘要依据 dependencies + package-lock 的锁定包树，不因插件自身版本或代码更新而改变。运行时验证清单版本和 Electron 可执行文件，绝不回退到插件内 node_modules。
- `node helper/install.cjs [--data-dir <auth-sdk>]` 显式执行一次安装；默认路径匹配 MyGo 正式应用。只向指定私有数据目录写 npm manifests / deps，使用 shell=false；安装完成后才写 ready marker。重复安装已完成的相同依赖时不再调用 npm。
- launcher 和 Electron 主进程通过同一依赖定位模块加载固定运行时。依赖缺失时显示完整 setup 指令，不在点击登录时隐式下载。
- probe 默认使用同一数据目录，因此无需第二份依赖；--data-dir 可覆盖到独立测试目录。
- 本机旧 helper/node_modules 迁移到代码目录之外（保留可恢复副本，不删除会话），随后依赖安装器验证/安装外部运行时。
- 发布 zip 按明确允许清单打包代码，排除 node_modules、.git、会话和 SDK 资源，遇到清单文件的符号链接则拒绝。输出放 .dist，不污染可导入目录。

## 先写回归测试

1. 实际 MyGo Open + Install 可以安装当前源码目录和最终 zip，安装结果无 node_modules。
2. 外部运行时路径在 plugin-data 内且不依赖源代码目录位置，代码升级不会改变依赖 key。
3. 默认路径/显式路径一致，平台/架构/依赖变化得到不同 key；非法相对路径报错。
4. 依赖安装只在外部目录运行，重复安装跳过 npm，失败不标记 ready，原有 auth-sdk 数据不变。
5. launcher 缺依赖安全报 setup；完整安装后私有管道启动、会话验证仍通过。
6. zip 中不存在符号链接、node_modules、Electron 二进制或会话数据；带符号链接的允许文件不能打包。

## 验收

先模拟测试，再用 MyGo 0.1.7 的真实安装器导入源码目录与 zip，最后用已验证的本插件私有会话测试实际 helper 启动。不能把直接 cp 到 plugins 当作安装器验收。安装到用户目录时使用干净代码，权限开关和账号数据不自动改写。

本次结果：移出依赖后源码目录通过实际 Open + Install；外部运行时安装成功，源目录不再含 node_modules。用户随后在 MyGo 中成功安装 0.2.1，实际应用启动的 Electron 路径已在 sdk-runtime 下；诊断记录 authenticated。独立探针因用户正在使用同一会话而返回 busy，这是预期的并发保护，未关闭用户应用或修改账号数据。播放问题另行排查。
