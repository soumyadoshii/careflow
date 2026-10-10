export function LoadingState({ label = 'Loading…' }: { label?: string }) { return <div className="panel loading-panel" role="status">{label}</div>; }
