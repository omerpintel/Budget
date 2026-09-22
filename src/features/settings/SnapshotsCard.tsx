import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, HardDriveDownload, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  createSnapshot,
  deleteSnapshot,
  downloadSnapshot,
  listSnapshots,
  restoreSnapshot,
} from '@/data/snapshots';

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SnapshotsCard() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots });
  const refresh = () => qc.invalidateQueries({ queryKey: ['snapshots'] });

  const take = useMutation({ mutationFn: createSnapshot, onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteSnapshot, onSuccess: refresh });

  if (!snapshots) return null;

  return (
    <Card>
      <CardHeader
        title="תצלומי מצב אוטומטיים"
        description="עותק של מסד הנתונים נשמר בעלייה, פעם ביום, ושבעה האחרונים נשמרים. הם נמצאים על המחשב הזה בלבד."
        action={
          <Button size="sm" variant="secondary" disabled={take.isPending} onClick={() => take.mutate()}>
            <HardDriveDownload className="size-3.5" />
            {take.isPending ? 'שומר…' : 'תצלום עכשיו'}
          </Button>
        }
      />
      <CardBody>
        {snapshots.length === 0 ? (
          <p className="text-fg-subtle text-xs">
            עדיין אין תצלומי מצב. הראשון יילקח אוטומטית בפעם הראשונה שתפעיל את האפליקציה עם נתונים.
          </p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.name} className="border-line/60 border-b last:border-0">
                  <td className="py-2 font-medium">
                    {new Date(snapshot.createdAt).toLocaleString('he-IL', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="text-fg-muted tnum py-2">{formatSize(snapshot.size)}</td>
                  <td className="py-2 text-end">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void downloadSnapshot(snapshot.name)}
                      >
                        <Download className="size-3.5" /> שמירה
                      </Button>
                      {confirming === snapshot.name ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={async () => {
                              await restoreSnapshot(snapshot.name);
                              window.location.reload();
                            }}
                          >
                            החלפת הכל
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                            ביטול
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(snapshot.name)}
                        >
                          <RotateCcw className="size-3.5" /> שחזור
                        </Button>
                      )}
                      <button
                        type="button"
                        aria-label={`מחיקת תצלום המצב ${snapshot.name}`}
                        className="text-fg-subtle hover:text-negative px-1"
                        onClick={() => remove.mutate(snapshot.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
