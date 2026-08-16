# patches/

pnpm `patchedDependencies` 的补丁存放目录（与官方 deepseek-harness 的包管理约定一致）。

## 用法

1. 在 `pnpm-workspace.yaml` 的 `patchedDependencies` 中登记，例如：

   ```yaml
   patchedDependencies:
     node-pty@1.1.0: patches/node-pty@1.1.0.patch
   ```

2. 补丁文件命名沿用官方风格：`<包名>@<版本>.patch`。

3. 生成补丁的推荐方式是 `pnpm patch <pkg>` / `pnpm patch-commit <dir>`，
   这样锁文件与 `patches/` 内容始终一致。

当前仓库没有需要打补丁的依赖，此目录与 `patchedDependencies: {}` 一起保留，
作为约定占位（保持与官方架构的包管理配置同构）。
