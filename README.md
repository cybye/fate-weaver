# Fate Weaver

An interactive text-adventure simulation game and narrative engine powered by a local Ollama Large Language Model.

The game is structured as a turn-based, multi-agent sandbox where non-player characters (NPCs) make utility-based pathfinding decisions, share information dynamically through room broadcasts, commit interactions to short-term memory lists, and react contextually. The chronicle of events is continuously translated into rich, novelistic fantasy prose by the scribe writer layer.

---

## Architecture Overview

The system is decoupled into three core layers:
1. **Simulation Layer (`game.js`, `actors.js`)**: Manages coordinates, inventories, pathfinding, and the main game tick loop.
2. **Director Layer (`content.js`)**: Configures story milestones (a Directed Acyclic Graph), room connections, and global lore facts.
3. **Chronicler Layer (`writer.js`, `ollama.js`)**: Compiles turn events and logs, translating them into cohesive, stylish paragraphs using a local LLM.

---

## Technical Features

* **Utility AI Agency**: NPCs compute weights for hunger, fatigue, and motivation constraints to decide whether to travel, stay, flee, or steal.
* **Dialogue Memory System**: Conversation exchanges are broadcasted to the room, so present NPCs save the query and reply in their memory database to avoid repetitive greetings and loop conversations.
* **NarratorIrony & Perception**: Secret actions (like pickpocketing) trigger perception checks. If failed, details are committed to hidden narrator logs, creating dramatic irony in the chronicle.
* **Separation of Concerns**: Core engine mechanics are completely independent of story variables. Rooms, NPC roles, items, and objectives are fed entirely from a story configuration schema in `content.js`.
* **Resilient LLM Parser**: Includes regex recovery parsers in `ollama.js` that capture and reconstruct valid string arrays even if the LLM output generates unescaped dialogue quote syntax errors.

---

## Installation & Setup

### Prerequisites
* [Node.js](https://nodejs.org/) (v16+)
* [Ollama](https://ollama.com/) (running locally)

### 1. Model Setup
Download the recommended model for the writer and parser:
```bash
ollama run gemma4:12b
```
*(You can customize the model name or Ollama port in `config.js` if you prefer to use `llama3` or a different model).*

### 2. Install Dependencies
Initialize and install standard static packages:
```bash
npm install
```

### 3. Running the Server
Start the local proxy server to route API endpoints internally:
```bash
npm start
```
The application will launch on [http://localhost:8080](http://localhost:8080).

---

## Repository Structure

```
├── game.js           # Engine loop, UI callbacks, tool-calling parser
├── actors.js         # NPC Utility AI loops, memories database, perception checks
├── writer.js         # Chronicle typewriter compiler and fallback narrative systems
├── content.js        # Story DAG milestones, room metrics, dialogue prompt instructions
├── config.js         # App configs (Ollama Url, default model, memory weights)
├── server.js         # HTTP server proxy routing LLM calls to localhost:11434
├── style.css         # Stylized layouts (parchment chronicle, command console UI)
└── index.html        # App interface markup
```
