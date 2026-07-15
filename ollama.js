import { ENGINE_CONFIG } from './config.js';

// Ollama HTTP client wrapper
export async function callOllama(prompt, systemInstruction = "") {
    const url = ENGINE_CONFIG.defaultOllamaUrl + "/api/generate";
    const model = ENGINE_CONFIG.defaultOllamaModel;

    // Inject format expectation in prompt
    const formattedPrompt = `${systemInstruction}\n\nRespond ONLY with a valid JSON block matching the exact structure. No markdown formatting. No conversational text.\n\nInput Context:\n${prompt}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: model,
                prompt: formattedPrompt,
                stream: false,
                format: "json",
                options: {
                    temperature: 0.6
                }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`Ollama returned status ${response.status}`);
        const data = await response.json();
        
        let rawText = data.response.trim();
        const start = rawText.indexOf('{');
        const end = rawText.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            rawText = rawText.substring(start, end + 1);
        }
        
        try {
            return dirtyJsonParse(rawText);
        } catch (parseError) {
            console.warn("[Ollama Client] JSON parsing failed, attempting regex extraction fallback:", parseError);
            
            const paragraphMatch = rawText.match(/"paragraph"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
            if (paragraphMatch) {
                return { paragraph: paragraphMatch[1].trim() };
            }
            
            const dialogueMatch = rawText.match(/"dialogue"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
            if (dialogueMatch) {
                return { dialogue: dialogueMatch[1].trim() };
            }

            // Actor plan/thought fallback
            const planMatch = rawText.match(/"plan"\s*:\s*\[([\s\S]*?)\]/);
            const thoughtMatch = rawText.match(/"thought"\s*:\s*"([\s\S]*?)"/);
            if (planMatch || thoughtMatch) {
                const plan = planMatch 
                    ? planMatch[1].split(',').map(s => s.replace(/["'\s]/g, '')).filter(Boolean)
                    : [];
                const thought = thoughtMatch ? thoughtMatch[1].trim() : "";
                return { plan, thought, desires: {} };
            }
            
            if (rawText.length > 20 && !rawText.includes("{")) {
                return { paragraph: rawText };
            }
            
            throw parseError;
        }
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

function dirtyJsonParse(rawText) {
    try {
        const repaired = jsonrepair(rawText);
        return JSON.parse(repaired);
    } catch (e) {
        console.warn("[Ollama Client] jsonrepair failed, trying direct parse fallback.", e);
        return JSON.parse(rawText);
    }
}

// Self-contained ES6 jsonrepair implementation and helpers
const regexUrlStart = /^https?:\/\//i;
const regexUrlChar = /[\w\-._~:\/?#\[\]@!$&'()*+,;=]/;

function isQuote(char) {
    return char === '"' || char === "'" || char === '`';
}
function isDoubleQuote(char) {
    return char === '"';
}
function isSingleQuote(char) {
    return char === "'";
}
function isSingleQuoteLike(char) {
    return char === '`';
}
function isDoubleQuoteLike(char) {
    return char === '“' || char === '”';
}
function isWhitespace(text, index) {
    if (index < 0 || index >= text.length) return false;
    const char = text[index];
    return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}
function isWhitespaceExceptNewline(text, index) {
    if (index < 0 || index >= text.length) return false;
    const char = text[index];
    return char === ' ' || char === '\t' || char === '\r';
}
function isSpecialWhitespace(text, index) {
    if (index < 0 || index >= text.length) return false;
    const char = text[index];
    return char === '\u00A0' || char === '\u2000' || char === '\u2001' || char === '\u2002' || char === '\u2003';
}
function isDelimiter(char) {
    return char === ',' || char === ':' || char === '[' || char === ']' || char === '{' || char === '}';
}
function isDigit(char) {
    return char >= '0' && char <= '9';
}
function isHex(char) {
    return (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F');
}
function isControlCharacter(char) {
    return char === '\b' || char === '\f' || char === '\n' || char === '\r' || char === '\t';
}
function isValidStringCharacter(char) {
    return true;
}
function isFunctionNameCharStart(char) {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_' || char === '$';
}
function isFunctionNameChar(char) {
    return isFunctionNameCharStart(char) || isDigit(char);
}
function isUnquotedStringDelimiter(char) {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || isDelimiter(char) || isQuote(char);
}
function insertBeforeLastWhitespace(output, char) {
    let j = output.length - 1;
    while (j >= 0 && (output[j] === ' ' || output[j] === '\t' || output[j] === '\n' || output[j] === '\r')) {
        j--;
    }
    return output.substring(0, j + 1) + char + output.substring(j + 1);
}
function endsWithCommaOrNewline(output) {
    let j = output.length - 1;
    while (j >= 0 && (output[j] === ' ' || output[j] === '\t' || output[j] === '\n' || output[j] === '\r')) {
        j--;
    }
    return output[j] === ',' || output[j] === '\n';
}
function stripLastOccurrence(output, char, quoteCheck = false) {
    let idx = output.lastIndexOf(char);
    if (idx !== -1) {
        return output.substring(0, idx) + output.substring(idx + 1);
    }
    return output;
}
function removeAtIndex(output, index, length) {
    return output.substring(0, index) + output.substring(index + length);
}

function jsonrepair(text) {
  var i = 0; 
  var output = '';

  parseMarkdownCodeBlock(['```', '[```', '{```']);

  var processed = parseValue();
  if (!processed) {
    throwUnexpectedEnd();
  }

  parseMarkdownCodeBlock(['```', '```]', '```}']);

  var processedComma = parseCharacter(',');
  if (processedComma) {
    parseWhitespaceAndSkipComments();
  }

  if (isStartOfValue(text[i]) && endsWithCommaOrNewline(output)) {
    if (!processedComma) {
      output = insertBeforeLastWhitespace(output, ',');
    }
    parseNewlineDelimitedJSON();
  } else if (processedComma) {
    output = stripLastOccurrence(output, ',');
  }

  while (text[i] === '}' || text[i] === ']') {
    i++;
    parseWhitespaceAndSkipComments();
  }

  if (i >= text.length) {
    return output;
  }

  throwUnexpectedCharacter();

  function isStartOfValue(c) {
    return c === '{' || c === '[' || c === '"' || c === "'" || isDigit(c) || c === '-' ||
           c === 't' || c === 'f' || c === 'n' || c === 'T' || c === 'F' || c === 'N';
  }

  function parseValue() {
    parseWhitespaceAndSkipComments();
    var processed =
      parseObject() ||
      parseArray() ||
      parseString() ||
      parseNumber() ||
      parseKeywords() ||
      parseUnquotedString(false) ||
      parseRegex();
    parseWhitespaceAndSkipComments();

    return processed;
  }

  function parseWhitespaceAndSkipComments(skipNewline = true) {
    var start = i;
    var changed = parseWhitespace(skipNewline);
    do {
      changed = parseComment();
      if (changed) {
        changed = parseWhitespace(skipNewline);
      }
    } while (changed);

    return i > start;
  }

  function parseWhitespace(skipNewline) {
    var _isWhiteSpace = skipNewline ? isWhitespace : isWhitespaceExceptNewline;
    var whitespace = '';

    while (true) {
      if (_isWhiteSpace(text, i)) {
        whitespace += text[i];
        i++;
      } else if (isSpecialWhitespace(text, i)) {
        whitespace += ' ';
        i++;
      } else {
        break;
      }
    }

    if (whitespace.length > 0) {
      output += whitespace;
      return true;
    }

    return false;
  }

  function parseComment() {
    if (text[i] === '/' && text[i + 1] === '*') {
      while (i < text.length && !atEndOfBlockComment(text, i)) {
        i++;
      }
      i += 2;
      return true;
    }

    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      return true;
    }

    return false;
  }

  function parseMarkdownCodeBlock(blocks) {
    if (skipMarkdownCodeBlock(blocks)) {
      if (isFunctionNameCharStart(text[i])) {
        while (i < text.length && isFunctionNameChar(text[i])) {
          i++;
        }
      }
      parseWhitespaceAndSkipComments();
      return true;
    }
    return false;
  }

  function skipMarkdownCodeBlock(blocks) {
    parseWhitespace(true);
    for (var j = 0; j < blocks.length; j++) {
      var block = blocks[j];
      var end = i + block.length;
      if (text.slice(i, end) === block) {
        i = end;
        return true;
      }
    }
    return false;
  }

  function parseCharacter(char) {
    if (text[i] === char) {
      output += text[i];
      i++;
      return true;
    }
    return false;
  }

  function skipCharacter(char) {
    if (text[i] === char) {
      i++;
      return true;
    }
    return false;
  }

  function skipEscapeCharacter() {
    return skipCharacter('\\');
  }

  function skipEllipsis() {
    parseWhitespaceAndSkipComments();
    if (text[i] === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
      i += 3;
      parseWhitespaceAndSkipComments();
      skipCharacter(',');
      return true;
    }
    return false;
  }

  function parseObject() {
    if (text[i] === '{') {
      output += '{';
      i++;
      parseWhitespaceAndSkipComments();

      if (skipCharacter(',')) {
        parseWhitespaceAndSkipComments();
      }

      var initial = true;
      while (i < text.length && text[i] !== '}') {
        var processedComma;
        if (!initial) {
          processedComma = parseCharacter(',');
          if (!processedComma) {
            output = insertBeforeLastWhitespace(output, ',');
          }
          parseWhitespaceAndSkipComments();
        } else {
          processedComma = true;
          initial = false;
        }

        skipEllipsis();

        var processedKey = parseString() || parseUnquotedString(true);
        if (!processedKey) {
          if (
            text[i] === '}' ||
            text[i] === '{' ||
            text[i] === ']' ||
            text[i] === '[' ||
            text[i] === undefined
          ) {
            output = stripLastOccurrence(output, ',');
          } else {
            throwObjectKeyExpected();
          }
          break;
        }

        parseWhitespaceAndSkipComments();
        var processedColon = parseCharacter(':');
        var truncatedText = i >= text.length;
        if (!processedColon) {
          if (isStartOfValue(text[i]) || truncatedText) {
            output = insertBeforeLastWhitespace(output, ':');
          } else {
            throwColonExpected();
          }
        }
        var processedValue = parseValue();
        if (!processedValue) {
          if (processedColon || truncatedText) {
            output += 'null';
          } else {
            throwColonExpected();
          }
        }
      }

      if (text[i] === '}') {
        output += '}';
        i++;
      } else {
        output = insertBeforeLastWhitespace(output, '}');
      }

      return true;
    }
    return false;
  }

  function parseArray() {
    if (text[i] === '[') {
      output += '[';
      i++;
      parseWhitespaceAndSkipComments();

      if (skipCharacter(',')) {
        parseWhitespaceAndSkipComments();
      }

      var initial = true;
      while (i < text.length && text[i] !== ']') {
        if (!initial) {
          var processedComma = parseCharacter(',');
          if (!processedComma) {
            output = insertBeforeLastWhitespace(output, ',');
          }
        } else {
          initial = false;
        }

        skipEllipsis();

        var processedValue = parseValue();
        if (!processedValue) {
          output = stripLastOccurrence(output, ',');
          break;
        }
      }

      if (text[i] === ']') {
        output += ']';
        i++;
      } else {
        output = insertBeforeLastWhitespace(output, ']');
      }

      return true;
    }
    return false;
  }

  function parseNewlineDelimitedJSON() {
    var initial = true;
    var processedValue = true;
    while (processedValue) {
      if (!initial) {
        var processedComma = parseCharacter(',');
        if (!processedComma) {
          output = insertBeforeLastWhitespace(output, ',');
        }
      } else {
        initial = false;
      }
      processedValue = parseValue();
    }

    if (!processedValue) {
      output = stripLastOccurrence(output, ',');
    }
    output = '[\n' + output + '\n]';
  }

  function parseString(stopAtDelimiter = false, stopAtIndex = -1) {
    var skipEscapeChars = text[i] === '\\';
    if (skipEscapeChars) {
      i++;
      skipEscapeChars = true;
    }

    if (isQuote(text[i])) {
      var isEndQuote = isDoubleQuote(text[i])
        ? isDoubleQuote
        : isSingleQuote(text[i])
          ? isSingleQuote
          : isSingleQuoteLike(text[i])
            ? isSingleQuoteLike
            : isDoubleQuoteLike;

      var iBefore = i;
      var oBefore = output.length;

      var str = '"';
      i++;

      while (true) {
        if (i >= text.length) {
          var iPrev = prevNonWhitespaceIndex(i - 1);
          if (!stopAtDelimiter && isDelimiter(text.charAt(iPrev))) {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(true);
          }
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          return true;
        }

        if (i === stopAtIndex) {
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          return true;
        }

        if (isEndQuote(text[i])) {
          var iQuote = i;
          var oQuote = str.length;
          str += '"';
          i++;
          output += str;

          parseWhitespaceAndSkipComments(false);

          if (
            stopAtDelimiter ||
            i >= text.length ||
            isDelimiter(text[i]) ||
            isQuote(text[i]) ||
            isDigit(text[i])
          ) {
            parseConcatenatedString();
            return true;
          }

          var iPrevChar = prevNonWhitespaceIndex(iQuote - 1);
          var prevChar = text.charAt(iPrevChar);

          if (prevChar === ',') {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(false, iPrevChar);
          }

          if (isDelimiter(prevChar)) {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(true);
          }

          output = output.substring(0, oBefore);
          i = iQuote + 1;
          str = str.substring(0, oQuote) + '\\' + str.substring(oQuote);
        } else if (stopAtDelimiter && isUnquotedStringDelimiter(text[i])) {
          if (text[i - 1] === ':' && regexUrlStart.test(text.substring(iBefore + 1, i + 2))) {
            while (i < text.length && regexUrlChar.test(text[i])) {
              str += text[i];
              i++;
            }
          }
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          parseConcatenatedString();
          return true;
        } else if (text[i] === '\\') {
          var char = text.charAt(i + 1);
          var escapeChar = escapeCharacters[char];
          if (escapeChar !== undefined) {
            str += text.slice(i, i + 2);
            i += 2;
          } else if (char === 'u') {
            var j = 2;
            while (j < 6 && isHex(text[i + j])) {
              j++;
            }
            if (j === 6) {
              str += text.slice(i, i + 6);
              i += 6;
            } else if (i + j >= text.length) {
              i = text.length;
            } else {
              throwInvalidUnicodeCharacter();
            }
          } else {
            str += char;
            i += 2;
          }
        } else {
          var char = text.charAt(i);
          if (char === '"' && text[i - 1] !== '\\') {
            str += '\\' + char;
            i++;
          } else if (isControlCharacter(char)) {
            str += controlCharacters[char];
            i++;
          } else {
            str += char;
            i++;
          }
        }

        if (skipEscapeChars) {
          skipEscapeCharacter();
        }
      }
    }
    return false;
  }

  function parseConcatenatedString() {
    var processed = false;
    parseWhitespaceAndSkipComments();
    while (text[i] === '+') {
      processed = true;
      i++;
      parseWhitespaceAndSkipComments();

      output = stripLastOccurrence(output, '"', true);
      var start = output.length;
      var parsedStr = parseString();
      if (parsedStr) {
        output = removeAtIndex(output, start, 1);
      } else {
        output = insertBeforeLastWhitespace(output, '"');
      }
    }
    return processed;
  }

  function parseNumber() {
    var start = i;
    if (text[i] === '-') {
      i++;
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
    }

    while (isDigit(text[i])) {
      i++;
    }

    if (text[i] === '.') {
      i++;
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
      while (isDigit(text[i])) {
        i++;
      }
    }

    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '-' || text[i] === '+') {
        i++;
      }
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
      while (isDigit(text[i])) {
        i++;
      }
    }

    if (!atEndOfNumber()) {
      i = start;
      return false;
    }

    if (i > start) {
      var num = text.slice(start, i);
      var hasInvalidLeadingZero = /^0\d/.test(num);
      output += hasInvalidLeadingZero ? '"' + num + '"' : num;
      return true;
    }
    return false;
  }

  function parseKeywords() {
    return (
      parseKeyword('true', 'true') ||
      parseKeyword('false', 'false') ||
      parseKeyword('null', 'null') ||
      parseKeyword('True', 'true') ||
      parseKeyword('False', 'false') ||
      parseKeyword('None', 'null')
    );
  }

  function parseKeyword(name, value) {
    if (text.slice(i, i + name.length) === name) {
      output += value;
      i += name.length;
      return true;
    }
    return false;
  }

  function parseUnquotedString(isKey) {
    var start = i;
    if (isFunctionNameCharStart(text[i])) {
      while (i < text.length && isFunctionNameChar(text[i])) {
        i++;
      }
      var j = i;
      while (isWhitespace(text, j)) {
        j++;
      }
      if (text[j] === '(') {
        i = j + 1;
        parseValue();
        if (text[i] === ')') {
          i++;
          if (text[i] === ';') {
            i++;
          }
        }
        return true;
      }
    }

    while (
      i < text.length &&
      !isUnquotedStringDelimiter(text[i]) &&
      !isQuote(text[i]) &&
      (!isKey || text[i] !== ':')
    ) {
      i++;
    }

    if (text[i - 1] === ':' && regexUrlStart.test(text.substring(start, i + 2))) {
      while (i < text.length && regexUrlChar.test(text[i])) {
        i++;
      }
    }

    if (i > start) {
      while (isWhitespace(text, i - 1) && i > 0) {
        i--;
      }
      var symbol = text.slice(start, i);
      output += symbol === 'undefined' ? 'null' : JSON.stringify(symbol);
      if (text[i] === '"') {
        i++;
      }
      return true;
    }
  }

  function parseRegex() {
    if (text[i] === '/') {
      var start = i;
      i++;
      while (i < text.length && (text[i] !== '/' || text[i - 1] === '\\')) {
        i++;
      }
      i++;
      output += JSON.stringify(text.substring(start, i));
      return true;
    }
  }

  function prevNonWhitespaceIndex(start) {
    var prev = start;
    while (prev > 0 && isWhitespace(text, prev)) {
      prev--;
    }
    return prev;
  }

  function atEndOfNumber() {
    return i >= text.length || isDelimiter(text[i]) || isWhitespace(text, i);
  }

  function repairNumberEndingWithNumericSymbol(start) {
    output += text.slice(start, i) + '0';
  }

  function throwUnexpectedCharacter() {
    throw new Error('Unexpected character at position ' + i);
  }

  function throwUnexpectedEnd() {
    throw new Error('Unexpected end of json string');
  }

  function throwObjectKeyExpected() {
    throw new Error('Object key expected at position ' + i);
  }

  function throwColonExpected() {
    throw new Error('Colon expected at position ' + i);
  }

  function throwInvalidUnicodeCharacter() {
    throw new Error('Invalid unicode character at position ' + i);
  }
}
}

export async function testOllamaConnection() {
    const url = ENGINE_CONFIG.defaultOllamaUrl + "/api/tags";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return res.ok;
    } catch (e) {
        clearTimeout(timeoutId);
        return false;
    }
}
