# Google Calendar Event Tracker

This script scrapes events from your Google Calendar, logs them into a Google Sheet, and tracks the duration of your events. It runs automatically every 5 minutes to check for calendar updates and records the event durations in your spreadsheet.

## Features
- Syncs events from Google Calendar to Google Sheets.
- Tracks event durations automatically.
- Updates every 5 minutes via a trigger.

## Implementation Steps

1. **Create a New Script:**
   - Go to [Google Apps Script](https://script.google.com/home/).
   - Click "New Project" to start a fresh script.

2. **Add the Code:**
   - Copy the contents of `script.js` into the editor.

3. **Configure Variables:**
   - At the top of the script, update these variables:
     - `calendarId`: Your Google Calendar ID.
     - `spreadsheetId`: The ID from your Google Sheet’s URL.
     - `sheetName`: The name of the sheet tab.

4. **Test the Script:**
   - Make a small change in your Google Calendar (e.g., add or edit an event).
   - In the Google Apps Script editor, select the `syncCalendarEvents` function from the dropdown menu.
   - Click the **Run** button.

5. **Authorize Permissions:**
   - Follow the Google verification prompts to grant the script access to your Calendar and Sheets.
   - Review and accept the permissions.

6. **Set Up a Trigger:**
   - In the left sidebar, click **Triggers** (clock icon).
   - if you dont see any triggers click **+ Add Trigger** (if this trigger is already there you can skip this step).
   - Configure it:
     - Function: `syncCalendarEvents`
     - Event: Time-driven
     - Time interval: Every 5 minutes
   - Save the trigger.
   - Verify it appears in the "Triggers" list.

8. **Check Your Sheet:**
   - Open your Google Sheet and confirm that event data (including durations) is being logged.

## Notes
- Ensure your Calendar and Sheet IDs are correct—errors here are common!
- The first run may take a moment to sync; subsequent updates happen every 5 minutes.
- Customize the script further (e.g., columns or formatting) based on your needs.
