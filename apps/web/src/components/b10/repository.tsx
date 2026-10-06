'use client';
import { useState } from 'react';
import { AiBadge, Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { api } from '@/lib/api-client';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Project {
  id: string;
  number: string;
  title: string;
  site: string;
  files: number;
  versions: number;
}
interface FileRow {
  id: string;
  folder: string;
  name: string;
  path: string;
  version: number;
  versions: number;
  checksum: string;
  sizeBytes: number;
  source: string;
  comment: string | null;
  createdAt: string;
}
interface Listing {
  project: { number: string; title: string; site: string };
  folders: Array<{ name: string; path: string; files: number }>;
  files: FileRow[];
}
interface Source {
  source: string;
  id: string;
  label: string;
  folder: string;
}

const toBase64 = (buf: ArrayBuffer) => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const enc = encodeURIComponent;

/** The simulated enterprise repository: a project picker, folders, files with their versions, upload and download (NFR-C06). */
export function RepositoryPage({
  csrf,
  canWrite,
  canPublish,
}: {
  csrf: string;
  canWrite: boolean;
  canPublish: boolean;
}) {
  const projects = useData<{ projects: Project[]; folders: string[] }>('/repository/projects');
  const [pid, setPid] = useState('');
  const [folder, setFolder] = useState('');
  const [history, setHistory] = useState<{ name: string; folder: string; rows: FileRow[] } | null>(null);
  const [upFolder, setUpFolder] = useState('General');
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState('');
  const { busy, run, messages } = useRun();
  const listing = useData<Listing>(
    pid ? `/repository/projects/${pid}/files${folder ? `?folder=${folder}` : ''}` : null,
  );
  const sources = useData<{ sources: Source[] }>(
    pid && canPublish ? `/repository/projects/${pid}/sources` : null,
  );

  if (projects.error && !projects.data)
    return (
      <p role="alert" className="text-sm font-medium text-error" data-testid="repo-error">
        {projects.error}
      </p>
    );
  if (!projects.data) return <p className="text-sm text-text-muted">Loading the repository…</p>;
  const l = listing.data;
  const showHistory = async (f: FileRow) => {
    const r = await api<{ versions: FileRow[] }>(
      `/repository/projects/${pid}/files/${f.folder}/${enc(f.name)}/versions`,
    );
    setHistory({ name: f.name, folder: f.folder, rows: r.versions });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Simulated SharePoint</h2>
          <AiBadge kind="simulated" />
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Each procurement is a site. Files are never overwritten: a change adds a version, and a change made
          to an old version is refused until the newest is read. You see only the procurements you can see
          elsewhere in the platform.
        </p>
        <div className="mt-3 max-w-md">
          <Field label="Project">
            <Select
              value={pid}
              onChange={(e) => {
                setPid(e.target.value);
                setFolder('');
                setHistory(null);
              }}
              data-testid="repo-project"
            >
              <option value="">Choose a project…</option>
              {projects.data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} {p.title} ({p.files} file{p.files === 1 ? '' : 's'})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      {messages}
      {pid && listing.error && (
        <p role="alert" className="text-sm font-medium text-error">
          {listing.error}
        </p>
      )}
      {l && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Folders">
            <Button variant={folder === '' ? 'primary' : 'secondary'} onClick={() => setFolder('')}>
              All folders
            </Button>
            {l.folders.map((f) => (
              <Button
                key={f.name}
                variant={folder === f.name ? 'primary' : 'secondary'}
                onClick={() => setFolder(f.name)}
                data-testid={`folder-${f.name}`}
              >
                {f.name} ({f.files})
              </Button>
            ))}
          </div>
          <p className="text-sm text-text-muted">
            Site <code>{l.project.site}</code>
          </p>
          <Table caption="Files">
            <thead>
              <tr>
                <Th>Folder</Th>
                <Th>Name</Th>
                <Th className="text-right">Version</Th>
                <Th>Source</Th>
                <Th>Checksum</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {l.files.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-text-muted">
                    Nothing is filed here yet.
                  </td>
                </tr>
              )}
              {l.files.map((f) => (
                <tr key={f.id} data-testid="repo-file">
                  <Td label="Folder">{f.folder}</Td>
                  <Td label="Name">{f.name}</Td>
                  <Td label="Version" className="text-right">
                    v{f.version} <span className="text-xs text-text-muted">of {f.versions}</span>
                  </Td>
                  <Td label="Source">
                    <Badge tone={f.source === 'PLATFORM' ? 'info' : 'neutral'}>
                      {f.source.toLowerCase()}
                    </Badge>
                  </Td>
                  <Td label="Checksum">
                    <code className="text-xs">{f.checksum.slice(0, 10)}</code>
                  </Td>
                  <Td label="Actions">
                    <a
                      className="mr-3 text-sm underline"
                      href={`/api/v1/repository/projects/${pid}/files/${f.folder}/${enc(f.name)}/download`}
                      data-testid="repo-download"
                    >
                      Download
                    </a>
                    <button type="button" className="text-sm underline" onClick={() => void showHistory(f)}>
                      Versions
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {history && (
            <Card data-testid="repo-history">
              <h3 className="font-heading text-lg font-bold">
                Versions of {history.folder}/{history.name}
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {history.rows.map((v) => (
                  <li key={v.version}>
                    <strong>v{v.version}</strong> · {new Date(v.createdAt).toLocaleString('en-AU')} ·{' '}
                    {v.sizeBytes} bytes · {v.comment ?? 'no comment'} ·{' '}
                    <a
                      className="underline"
                      href={`/api/v1/repository/projects/${pid}/files/${v.folder}/${enc(v.name)}/download?version=${v.version}`}
                    >
                      Download this version
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {canWrite && (
            <Card>
              <h3 className="font-heading text-lg font-bold">Upload a small file</h3>
              <p className="text-sm text-text-muted">
                Up to 2 MB. If the name already exists you add the next version, starting from the one you
                last saw.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <Field label="Folder">
                  <Select value={upFolder} onChange={(e) => setUpFolder(e.target.value)}>
                    {projects.data.folders.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="File">
                  <Input
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    data-testid="repo-upload-file"
                  />
                </Field>
                <Button
                  disabled={!file}
                  loading={busy === 'up'}
                  onClick={() =>
                    void run(
                      'up',
                      async () => {
                        const f = file!;
                        const cur = l.files.find((x) => x.folder === upFolder && x.name === f.name);
                        const res = await fetch(
                          `/api/v1/repository/projects/${pid}/files/${upFolder}/${enc(f.name)}`,
                          {
                            method: 'PUT',
                            headers: {
                              'content-type': 'application/json',
                              'x-csrf-token': csrf,
                              ...(cur ? { 'if-match': `"${cur.version}"` } : {}),
                            },
                            body: JSON.stringify({ contentBase64: toBase64(await f.arrayBuffer()) }),
                          },
                        );
                        const j = (await res.json().catch(() => ({}))) as { title?: string; result?: string };
                        if (!res.ok) throw new Error(j.title ?? 'The upload was refused');
                        await Promise.all([listing.reload(), projects.reload()]);
                      },
                      'Saved as the next version.',
                    )
                  }
                  data-testid="repo-upload"
                >
                  Upload
                </Button>
              </div>
            </Card>
          )}
          {canPublish && (sources.data?.sources.length ?? 0) > 0 && (
            <Card>
              <h3 className="font-heading text-lg font-bold">File a platform document</h3>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <Field label="Document">
                  <Select value={src} onChange={(e) => setSrc(e.target.value)} data-testid="repo-source">
                    <option value="">Choose…</option>
                    {sources.data!.sources.map((s) => (
                      <option key={s.id} value={`${s.source}|${s.id}`}>
                        {s.label} to {s.folder}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  disabled={!src}
                  loading={busy === 'pub'}
                  onClick={() =>
                    void run(
                      'pub',
                      async () => {
                        const [source, sourceId] = src.split('|');
                        await send(csrf, 'POST', `/repository/projects/${pid}/publish`, { source, sourceId });
                        await Promise.all([listing.reload(), projects.reload()]);
                      },
                      'Filed in the repository.',
                    )
                  }
                  data-testid="repo-publish"
                >
                  Publish to the repository
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
