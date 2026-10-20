import type { Era } from "../types";

export const eras: Era[] = [
  {
    id: "early",
    name: "Early Civilizations",
    start: -3400,
    end: -800,
    blurb: "Cities, states and scribes. Knowledge leaves the human head for the first time.",
  },
  {
    id: "axial",
    name: "The Axial Age",
    start: -800,
    end: -200,
    blurb: "Across Greece, India, China and Persia, people begin asking how to live and what is real.",
  },
  {
    id: "classical",
    name: "Classical Empires",
    start: -200,
    end: 500,
    blurb: "Great empires systematize law, faith and knowledge, and carry them across continents.",
  },
  {
    id: "medieval",
    name: "The Medieval World",
    start: 500,
    end: 1400,
    blurb: "New faiths spread, the Islamic Golden Age preserves and extends learning, universities appear.",
  },
  {
    id: "renaissance",
    name: "Renaissance & Reformation",
    start: 1400,
    end: 1600,
    blurb: "Print breaks the monopoly on knowledge. Authority — of Church, ancients and heavens — is questioned.",
  },
  {
    id: "enlightenment",
    name: "Scientific Revolution & Enlightenment",
    start: 1600,
    end: 1800,
    blurb: "Reason and experiment become the method. Rights and consent become the basis of government.",
  },
  {
    id: "industrial",
    name: "The Industrial Century",
    start: 1800,
    end: 1900,
    blurb: "Machines reshape society, and new theories try to explain life, economy and history itself.",
  },
  {
    id: "modern",
    name: "The Modern Age",
    start: 1900,
    end: 1970,
    blurb: "Certainty fractures: relativity, quantum theory, the unconscious, and the logic of machines.",
  },
  {
    id: "information",
    name: "The Information Age",
    start: 1970,
    end: 2100,
    blurb: "Networks connect the planet, and we begin building machines that learn.",
  },
];
