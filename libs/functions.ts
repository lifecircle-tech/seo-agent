/**
 * Checks if a given date is an alternate weekday (Monday, Wednesday, Friday).
 */
export function isExtractionDay(date: Date): boolean {
  const day: number = date.getDay();
  // 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
  return day === 1 || day === 3 || day === 5;
}

/**
 * Calculates which extraction day of the month this is (0-indexed).
 * For example, the first Monday/Wednesday/Friday of the month returns 0.
 */
export function getExtractionCountForMonth(date: Date): number {
  let count: number = 0;
  const currentDay: number = date.getDate();

  // Loop from the 1st of the month up to the current date
  for (let i = 1; i <= currentDay; i++) {
    const checkDate = new Date(date.getFullYear(), date.getMonth(), i);
    if (isExtractionDay(checkDate)) {
      count++;
    }
  }

  // Subtract 1 because we want our multiplier to be 0-indexed
  return count - 1;
}

/**
 * Main function to get the start index for a specific date.
 */
export function getStartIndex(
  date: Date,
  elementsPerDay: number,
): number | void {
  // 1. If it's not a Mon, Wed, or Fri, return.
  if (!isExtractionDay(date)) {
    return;
  }

  // 2. Figure out how many extraction days have happened so far this month.
  const extractionIndex: number = getExtractionCountForMonth(date);

  // 3. Calculate our starting position in the array.
  // We use modulo (%) just in case the start index exceeds the array's length.
  const startIndex: number = extractionIndex * elementsPerDay;

  return startIndex;
}
