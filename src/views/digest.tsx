import type { ReadNightResult } from '../digest/types.js';

export function DigestPage({ digest }: { digest: ReadNightResult }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>bad lines: {digest.badLines}</p>
      {digest.missing ? (
        <p class="warn">night not found</p>
      ) : digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <>
          <p class="mute">Warnings mark 3 or more retries and any failure, even after recovery.</p>
          <table>
            <thead>
              <tr>
                <th scope="col">job</th>
                <th scope="col">owner</th>
                <th scope="col">runs</th>
                <th scope="col">retries</th>
                <th scope="col">last status</th>
                <th scope="col">last error</th>
                <th scope="col">first time</th>
                <th scope="col">last time</th>
                <th scope="col">any failure</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map((row) => (
                <tr>
                  <th scope="row">{row.job}</th>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td class={row.retries >= 3 ? 'warn' : undefined}>
                    {row.retries >= 3 ? <strong>{row.retries} (high)</strong> : row.retries}
                  </td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? '—'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                  <td class={row.hasFailure ? 'warn' : undefined}>
                    {row.hasFailure ? <strong>yes</strong> : 'no'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
