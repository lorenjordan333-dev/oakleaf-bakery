import React, { useState } from "react";

const ITEMS = [
  {
    id: "sourdough",
    name: "Sourdough loaf",
    blurb: "Two-day ferment, baked dark. Sells out by ten most mornings.",
    price: 4.5,
  },
  {
    id: "croissant",
    name: "Almond croissant",
    blurb: "Yesterday's croissants, split, soaked, and filled with frangipane.",
    price: "$3.20",
  },
  {
    id: "bun",
    name: "Cinnamon bun",
    blurb: "Cardamom in the dough, brown butter glaze on top.",
    price: 3.75,
  },
];

function money(value) {
  return `$${Number(String(value).replace("$", "")).toFixed(2)}`;
}

export default function App() {
  const [box, setBox] = useState(0);

  const weekendBox = ITEMS.reduce((sum, item) => sum + Number(item.price), 0);

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Oakleaf Bakery</h1>
          <p className="tagline">Wood-fired, three streets back from the harbour.</p>
        </div>
        <div className="box-count">box · {box} item{box === 1 ? "" : "s"}</div>
      </header>

      <div className="grid">
        {ITEMS.map((item) => (
          <article className="card" key={item.id}>
            <h2>{item.name}</h2>
            <p>{item.blurb}</p>
            <div className="price">{money(item.price)}</div>
            <button onClick={() => setBox((n) => n + 1)}>Add to box</button>
          </article>
        ))}
      </div>

      <section className="bundle">
        <div>
          <div className="bundle-label">Weekend box</div>
          <p className="bundle-note">One of everything, collected Saturday morning.</p>
        </div>
        <div className="bundle-price">{money(weekendBox)}</div>
      </section>

      <footer>Open Tuesday to Saturday, 7am until we run out.</footer>
    </div>
  );
}
