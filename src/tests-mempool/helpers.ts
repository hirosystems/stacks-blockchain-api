export function getNextChar(char: string) {
  if (char === 'z') {
    return 'a';
  }

  if (char === 'Z') {
    return 'A';
  }
  return String.fromCharCode(char.charCodeAt(0) + 1);
}

export function getPrevChar(char: string) {
  if (char === 'a') {
    return 'z';
  }

  if (char === 'A') {
    return 'Z';
  }

  return String.fromCharCode(char.charCodeAt(0) - 1);
}
