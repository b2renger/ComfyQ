import { useState } from 'react';

// How the batch feature names a card: the title students see, then the model
// it runs (`name` in the meta). They are different layers of the card's text
// (title + summary in plain words, name = the model, description = technical),
// and someone composing a batch needs the model as much as the title.
// `card` is an entry of GET /storyboard/cards; without one, the bare id.
export const CardName = ({ card, id, className = '' }) => {
    if (!card) return <span className={className}>{id}</span>;
    return (
        <span className={className} title={card.id}>
            {card.title}
            {card.name && card.name !== card.title && <span className="opacity-70"> · {card.name}</span>}
        </span>
    );
};


// Long descriptions (median about 900 characters) open clamped to three lines.
const LONG = 260;

// What the card does: the model, the summary, then the technical description.
// A field the server does not send yet is simply left out.
export const CardAbout = ({ card }) => {
    const [all, setAll] = useState(false);
    if (!card || (!card.name && !card.summary && !card.description)) return null;
    const long = (card.description || '').length > LONG;
    return (
        <div className="text-xs space-y-1 p-2 rounded-lg bg-background/40 border border-border/60">
            {card.name && (
                <p>
                    <span className="text-muted">Model: </span>
                    <span className="font-medium text-foreground">{card.name}</span>
                    {card.experimental && <span className="text-warning"> · experimental</span>}
                </p>
            )}
            {card.summary && <p className="text-foreground">{card.summary}</p>}
            {card.description && (
                <div>
                    <p className={`text-muted whitespace-pre-line ${long && !all ? 'line-clamp-3' : ''}`}>{card.description}</p>
                    {long && (
                        <button type="button" className="text-primary hover:underline" onClick={() => setAll(v => !v)}>
                            {all ? 'Show less' : 'Show the whole description'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

