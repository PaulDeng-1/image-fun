// /me 进入时的瞬时骨架，避免 server component 慢导致白屏
// 真实数据由 page.tsx 异步渲染完后替换
export default function MeLoading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 inline-flex h-10 w-28 animate-pulse rounded-lg bg-line-soft" />
      <div className="px-5 pb-12 md:px-8">
        <div className="mb-8 space-y-3">
          <div className="h-3 w-16 animate-pulse rounded bg-line-soft" />
          <div className="h-9 w-40 animate-pulse rounded bg-line-soft" />
        </div>
        <div className="space-y-4">
          <div className="h-40 animate-pulse rounded-2xl bg-line-soft/70" />
          <div className="h-32 animate-pulse rounded-2xl bg-line-soft/70" />
          <div className="h-56 animate-pulse rounded-2xl bg-line-soft/70" />
        </div>
      </div>
    </div>
  );
}
