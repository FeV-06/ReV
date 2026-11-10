export default function ContributorField({ value, onChange, authors, repository }: {
  value: string;
  onChange: (value: string) => void;
  authors: string[];
  repository: string | null;
}) {
  const query = value.trim().toLowerCase();
  const matches = authors.filter(author => {
    const name = author.toLowerCase();
    return name !== query && name.includes(query);
  }).slice(0, 8);

  return <div className="contributor-field">
    <label>Who’s leaving?
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        autoComplete="off"
        maxLength={120}
        placeholder="GitHub username (without @) or Git author name"
      />
    </label>
    {matches.length > 0 && <div className="contributor-suggestions" role="group" aria-label="Recent Git authors">
      {matches.map(author => <button key={author} className="m3-contributor-option" type="button" onClick={() => onChange(author)}>
        {author}
      </button>)}
    </div>}
    {authors.length > 0 && <p className="footnote">Choose an author from recent commits in {repository}, or enter a name.</p>}
  </div>;
}
