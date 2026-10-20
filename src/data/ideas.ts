import type { Idea } from "../types";

export const ideas: Idea[] = [
  // Early Civilizations
  {
    id: "writing",
    year: -3200,
    approx: true,
    title: "Writing",
    origin: "Uruk, Mesopotamia",
    summary:
      "Accounting tokens become marks pressed into clay. Cuneiform lets memory, law and trade outlive the people who made them.",
    category: "technology",
  },
  {
    id: "place-value",
    year: -1800,
    approx: true,
    title: "Positional Mathematics",
    origin: "Babylon",
    summary:
      "A base-60 place-value system makes large calculations tractable — its echo survives in our 60-minute hours and 360° circles.",
    category: "mathematics",
    buildsOn: ["writing"],
  },
  {
    id: "hammurabi",
    year: -1754,
    approx: true,
    title: "Written Law",
    origin: "Code of Hammurabi, Babylon",
    summary:
      "Laws carved in public stone: justice as a fixed, knowable standard rather than the whim of a ruler.",
    category: "politics",
    buildsOn: ["writing"],
  },
  {
    id: "monotheism",
    year: -1350,
    approx: true,
    title: "Monotheism",
    origin: "Akhenaten, Egypt; later the Hebrew Bible",
    summary:
      "The radical notion of a single, universal god — briefly tried in Egypt, later the foundation of Judaism, Christianity and Islam.",
    category: "religion",
  },
  {
    id: "alphabet",
    year: -1050,
    approx: true,
    title: "The Alphabet",
    origin: "Phoenicia",
    summary:
      "Two dozen symbols for sounds instead of thousands for words. Literacy is no longer the preserve of a scribal elite.",
    category: "technology",
    buildsOn: ["writing"],
  },

  // Axial Age
  {
    id: "natural-philosophy",
    year: -585,
    title: "Natural Explanation",
    origin: "Thales of Miletus",
    summary:
      "The world can be explained by natural causes rather than the will of gods — the seed of both philosophy and science.",
    category: "philosophy",
  },
  {
    id: "buddhism",
    year: -500,
    approx: true,
    title: "Buddhism",
    origin: "Siddhartha Gautama, India",
    summary:
      "Suffering arises from craving and can be ended through insight and discipline — a path to liberation open to anyone.",
    category: "religion",
  },
  {
    id: "confucianism",
    year: -500,
    approx: true,
    title: "Confucian Ethics",
    origin: "Confucius, China",
    summary:
      "Social harmony grows from virtue, ritual and right relationships. It would shape Chinese government for two millennia.",
    category: "philosophy",
  },
  {
    id: "democracy",
    year: -508,
    title: "Democracy",
    origin: "Cleisthenes, Athens",
    summary:
      "Citizens govern themselves directly by vote. Limited to free men, but the principle of rule by the people is born.",
    category: "politics",
    buildsOn: ["hammurabi"],
  },
  {
    id: "socratic",
    year: -399,
    title: "The Examined Life",
    origin: "Socrates, Athens",
    summary:
      "Truth is pursued by relentless questioning. Executed for it, Socrates makes intellectual inquiry a moral act.",
    category: "philosophy",
    buildsOn: ["natural-philosophy", "democracy"],
  },
  {
    id: "logic",
    year: -350,
    approx: true,
    title: "Formal Logic",
    origin: "Aristotle",
    summary:
      "The syllogism codifies valid reasoning itself. Aristotle's system would dominate Western and Islamic thought for 2,000 years.",
    category: "philosophy",
    buildsOn: ["socratic"],
  },
  {
    id: "euclid",
    year: -300,
    approx: true,
    title: "Axiomatic Proof",
    origin: "Euclid's Elements, Alexandria",
    summary:
      "From a handful of axioms, all of geometry follows by proof. The template for rigorous knowledge ever since.",
    category: "mathematics",
    buildsOn: ["logic", "place-value"],
  },

  // Classical Empires
  {
    id: "christianity",
    year: 30,
    approx: true,
    title: "Christianity",
    origin: "Jesus of Nazareth, Judea",
    summary:
      "A message of universal love and salvation that would become the faith of the Roman Empire and reshape the West.",
    category: "religion",
    buildsOn: ["monotheism"],
  },
  {
    id: "paper",
    year: 105,
    title: "Paper",
    origin: "Cai Lun, Han China",
    summary:
      "A cheap, light writing surface from plant fibre. It travels the Silk Road and makes books abundant.",
    category: "technology",
    buildsOn: ["writing"],
  },
  {
    id: "ptolemy",
    year: 150,
    approx: true,
    title: "Mathematical Astronomy",
    origin: "Ptolemy's Almagest",
    summary:
      "An Earth-centred cosmos described with geometric precision — wrong, but predictive enough to reign for 1,400 years.",
    category: "science",
    buildsOn: ["euclid"],
  },

  // Medieval
  {
    id: "islam",
    year: 610,
    title: "Islam",
    origin: "Muhammad, Arabia",
    summary:
      "A unifying faith and legal tradition that, within a century, spans from Spain to Central Asia.",
    category: "religion",
    buildsOn: ["monotheism"],
  },
  {
    id: "zero",
    year: 628,
    title: "Zero as a Number",
    origin: "Brahmagupta, India",
    summary:
      "Zero gets rules of arithmetic of its own. With Hindu–Arabic numerals, calculation becomes something anyone can do.",
    category: "mathematics",
    buildsOn: ["place-value"],
  },
  {
    id: "algebra",
    year: 820,
    approx: true,
    title: "Algebra",
    origin: "al-Khwarizmi, Baghdad",
    summary:
      "Systematic methods for solving equations. His name gives us the word algorithm.",
    category: "mathematics",
    buildsOn: ["zero", "euclid"],
  },
  {
    id: "university",
    year: 1088,
    title: "The University",
    origin: "Bologna",
    summary:
      "A self-governing community of scholars. Learning gains an institution independent of monastery and court.",
    category: "philosophy",
  },
  {
    id: "magna-carta",
    year: 1215,
    title: "Rule of Law",
    origin: "Magna Carta, England",
    summary:
      "Even the king is bound by law. A narrow baronial deal becomes a lasting symbol of limits on power.",
    category: "politics",
    buildsOn: ["hammurabi"],
  },

  // Renaissance & Reformation
  {
    id: "printing",
    year: 1440,
    approx: true,
    title: "The Printing Press",
    origin: "Johannes Gutenberg, Mainz",
    summary:
      "Movable metal type makes books cheap and identical. Within fifty years, millions are in circulation.",
    category: "technology",
    buildsOn: ["paper", "alphabet"],
  },
  {
    id: "machiavelli",
    year: 1513,
    title: "Political Realism",
    origin: "Machiavelli, The Prince",
    summary:
      "Politics described as it is, not as it ought to be. Power is analysed on its own terms.",
    category: "politics",
  },
  {
    id: "reformation",
    year: 1517,
    title: "The Reformation",
    origin: "Martin Luther, Wittenberg",
    summary:
      "Individual conscience and scripture over Church authority. Printing spreads the challenge across Europe in weeks.",
    category: "religion",
    buildsOn: ["christianity", "printing"],
  },
  {
    id: "heliocentrism",
    year: 1543,
    title: "Heliocentrism",
    origin: "Copernicus",
    summary:
      "The Earth moves around the Sun. Humanity is displaced from the centre of the cosmos.",
    category: "science",
    buildsOn: ["ptolemy"],
  },

  // Scientific Revolution & Enlightenment
  {
    id: "scientific-method",
    year: 1620,
    title: "The Scientific Method",
    origin: "Francis Bacon, Novum Organum",
    summary:
      "Knowledge built from systematic observation and experiment rather than inherited authority.",
    category: "science",
    buildsOn: ["natural-philosophy", "heliocentrism"],
  },
  {
    id: "newton",
    year: 1687,
    title: "Universal Laws of Nature",
    origin: "Isaac Newton, Principia",
    summary:
      "The same mathematical laws govern a falling apple and orbiting planets. The universe becomes a knowable machine.",
    category: "science",
    buildsOn: ["heliocentrism", "scientific-method", "algebra"],
  },
  {
    id: "social-contract",
    year: 1689,
    title: "Natural Rights",
    origin: "John Locke, Two Treatises",
    summary:
      "People are born with rights to life, liberty and property; government is legitimate only by their consent.",
    category: "politics",
    buildsOn: ["magna-carta"],
  },
  {
    id: "separation-of-powers",
    year: 1748,
    title: "Separation of Powers",
    origin: "Montesquieu, The Spirit of the Laws",
    summary:
      "Liberty is safest when legislative, executive and judicial power check one another.",
    category: "politics",
    buildsOn: ["social-contract"],
  },
  {
    id: "free-markets",
    year: 1776,
    title: "The Market Economy",
    origin: "Adam Smith, The Wealth of Nations",
    summary:
      "Self-interest, coordinated by markets and the division of labour, produces collective prosperity.",
    category: "economics",
  },
  {
    id: "rights-of-man",
    year: 1789,
    title: "Universal Rights",
    origin: "Declaration of the Rights of Man, France",
    summary:
      "Rights belong to all people by nature. Revolutions in America and France put Enlightenment ideas into practice.",
    category: "politics",
    buildsOn: ["social-contract", "separation-of-powers"],
  },
  {
    id: "wollstonecraft",
    year: 1792,
    title: "Women's Rights",
    origin: "Mary Wollstonecraft",
    summary:
      "If rights are universal, they belong to women too. An argument that would take centuries to win.",
    category: "politics",
    buildsOn: ["rights-of-man"],
  },

  // Industrial Century
  {
    id: "communism",
    year: 1848,
    title: "Historical Materialism",
    origin: "Marx & Engels, The Communist Manifesto",
    summary:
      "History is a struggle between classes; capitalism will give way to collective ownership. It would move nations.",
    category: "economics",
    buildsOn: ["free-markets"],
  },
  {
    id: "evolution",
    year: 1859,
    title: "Evolution by Natural Selection",
    origin: "Charles Darwin, On the Origin of Species",
    summary:
      "All life descends from common ancestors, shaped by selection over immense time. Humanity joins the animal kingdom.",
    category: "science",
    buildsOn: ["scientific-method"],
  },
  {
    id: "liberty",
    year: 1859,
    title: "Individual Liberty",
    origin: "John Stuart Mill, On Liberty",
    summary:
      "The only justification for restricting a person's freedom is to prevent harm to others.",
    category: "philosophy",
    buildsOn: ["social-contract"],
  },
  {
    id: "germ-theory",
    year: 1861,
    approx: true,
    title: "Germ Theory",
    origin: "Louis Pasteur, Robert Koch",
    summary:
      "Microorganisms cause disease. Sanitation, vaccines and antibiotics follow; life expectancy soars.",
    category: "science",
    buildsOn: ["scientific-method"],
  },

  // Modern Age
  {
    id: "unconscious",
    year: 1900,
    title: "The Unconscious Mind",
    origin: "Sigmund Freud, The Interpretation of Dreams",
    summary:
      "Much of what drives us is hidden from ourselves. The self is no longer fully transparent to reason.",
    category: "philosophy",
  },
  {
    id: "relativity",
    year: 1905,
    title: "Relativity",
    origin: "Albert Einstein",
    summary:
      "Space and time are not absolute but bend with motion and gravity. Mass and energy are interchangeable.",
    category: "science",
    buildsOn: ["newton"],
  },
  {
    id: "quantum",
    year: 1925,
    title: "Quantum Mechanics",
    origin: "Heisenberg, Schrödinger, Bohr",
    summary:
      "At the smallest scales, nature is probabilistic. The clockwork universe gives way to uncertainty.",
    category: "science",
    buildsOn: ["newton"],
  },
  {
    id: "computation",
    year: 1936,
    title: "Universal Computation",
    origin: "Alan Turing",
    summary:
      "A single abstract machine can perform any computation. The theoretical blueprint for every computer.",
    category: "mathematics",
    buildsOn: ["logic", "algebra"],
  },
  {
    id: "human-rights",
    year: 1948,
    title: "Universal Human Rights",
    origin: "United Nations",
    summary:
      "After world war and genocide, the nations of the world affirm rights belonging to every human being.",
    category: "politics",
    buildsOn: ["rights-of-man"],
  },
  {
    id: "information-theory",
    year: 1948,
    title: "Information Theory",
    origin: "Claude Shannon",
    summary:
      "Information can be measured in bits and transmitted reliably through noise. The foundation of digital communication.",
    category: "mathematics",
    buildsOn: ["computation"],
  },
  {
    id: "dna",
    year: 1953,
    title: "The Double Helix",
    origin: "Franklin, Watson & Crick",
    summary:
      "Heredity is written in a molecular code. Life itself becomes legible as information.",
    category: "science",
    buildsOn: ["evolution"],
  },
  {
    id: "paradigms",
    year: 1962,
    title: "Paradigm Shifts",
    origin: "Thomas Kuhn",
    summary:
      "Science advances not steadily but through revolutions that overturn whole frameworks of thought.",
    category: "philosophy",
    buildsOn: ["scientific-method"],
  },

  // Information Age
  {
    id: "internet",
    year: 1969,
    title: "Packet-Switched Networks",
    origin: "ARPANET",
    summary:
      "Computers talk to each other by breaking messages into packets. The seed of the internet.",
    category: "technology",
    buildsOn: ["information-theory"],
  },
  {
    id: "web",
    year: 1989,
    title: "The World Wide Web",
    origin: "Tim Berners-Lee, CERN",
    summary:
      "Hyperlinked documents open to anyone. Publishing becomes nearly free, as printing once made copying cheap.",
    category: "technology",
    buildsOn: ["internet", "printing"],
  },
  {
    id: "deep-learning",
    year: 2012,
    title: "Deep Learning",
    origin: "AlexNet, University of Toronto",
    summary:
      "Neural networks trained on vast data surpass hand-built systems. Machines learn from examples, not rules.",
    category: "technology",
    buildsOn: ["computation", "web"],
  },
  {
    id: "transformer",
    year: 2017,
    title: "The Transformer",
    origin: "\"Attention Is All You Need\", Google",
    summary:
      "An architecture that learns from language at scale — the basis of today's large language models.",
    category: "technology",
    buildsOn: ["deep-learning", "writing"],
  },
];
