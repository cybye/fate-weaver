# Workspace Rules & Principles

## Game Design Principles
Whenever editing, extending, or verifying the game logic or narrative engine in this workspace, ensure changes align with these four principles:

1. **Convergence First**  
   The narrative must progress. If soft nudges fail, the Director Engine must use stronger interventions (e.g., path blockages or off-screen repositioning) to guarantee key events occur on time.
   
2. **Hybrid Utility-Based Actor Agency**  
   NPCs should run on a Utility AI system (evaluating motivations like hunger, fatigue, or social desires combined with pathfinding distance) rather than rigid scripts. The Director influences them by dynamically scaling utility weights.
   
3. **Subtly Telegraphed Nudges**  
   Any Director-driven environmental blockages or path redirections must be telegraphed to the player via narrative descriptions/rumors in the game log to maintain immersion.

4. **Separation of Engine and Content**  
   The core game engine (loop mechanics, pathfinding, Ollama service, state storage, UI renderer) must be completely decoupled from the specific story, rooms, items, actors, and prompts. All content must be defined in a configuration object or JSON data structure.
