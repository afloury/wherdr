// A user message of the conversation, as the bubble shows it: its photos and
// attached files leave the text. A photo path stays as text in the transcript
// when the agent did not turn it into an image (a message sent again from
// Claude's input with Send now, or taken from Claude's own queue): it still
// shows as the photo (wherdr keeps a copy of each, see corePutPhoto), never as
// a path. Both the v2 uploads folder and herdr-core's own (see queuedMatch.ts).
import { isUploadLine, uploadNames } from '../../shared/queuedMatch'
import { isAttachmentLine, parseAttachmentLine } from '../../shared/attachments'

export interface UserMessageParts {
  text: string
  // Stored names of the photos whose path stayed as text.
  photos: string[]
  files: { path: string, name: string }[]
}

export function userMessageParts(raw: string): UserMessageParts {
  const lines = String(raw || '').split('\n')
  return {
    text: lines.filter(l => !isUploadLine(l) && !isAttachmentLine(l)).join('\n').trim(),
    photos: uploadNames(raw),
    files: lines.map(parseAttachmentLine).filter((f): f is { path: string, name: string } => Boolean(f)),
  }
}
