import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { Button } from './ui/Button';
import { Card, CardBody, CardHeader } from './ui/Card';
import { downloadBackup } from '@/data/backup';

interface State {
  error: Error | null;
}

/**
 * A render crash must never cost the ledger, so the fallback offers an export
 * before anything else.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="border-negative/40 max-w-lg">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <AlertTriangle className="text-negative size-4" />
                Something broke on this screen
              </span>
            }
            description="Your data is untouched. Export a copy before reloading if you want to be certain."
          />
          <CardBody className="space-y-4">
            <pre className="border-line bg-surface-2 text-fg-muted max-h-40 overflow-auto rounded-lg border p-3 text-[11px] whitespace-pre-wrap">
              {error.message}
            </pre>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => window.location.reload()}>
                <RotateCcw className="size-3.5" /> Reload
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void downloadBackup()}>
                <Download className="size-3.5" /> Export database
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }
}
