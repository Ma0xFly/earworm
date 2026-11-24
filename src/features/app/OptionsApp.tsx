/**
 * Options page content (T1 stub).
 *
 * T7 replaces this with the real settings form (LLM endpoint trio + test
 * connection, blur defaults, continuous-play default, optional host
 * permission request). The options entrypoint imports `OptionsApp` from
 * `@/features/options`, so T7 only edits that directory.
 */
export function OptionsApp() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Earworm 设置</h1>
      <p className="text-muted-foreground">
        设置页正在搭建中（ticket T7）。届时可在此配置 LLM 端点、测试连接，以及模糊与连续播放的默认状态。
      </p>
    </main>
  );
}
