// Socket.io event names for the collaborative drawing app

export const SOCKET_EVENTS = {
  // Connection events
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',

  // Room events
  JOIN_ROOM: 'room:join',
  LEAVE_ROOM: 'room:leave',
  ROOM_JOINED: 'room:joined',
  ROOM_LEFT: 'room:left',
  ROOM_ERROR: 'room:error',
  ROOM_DELETED: 'room:deleted',

  // Drawing events
  STROKE_ADD: 'stroke:add',
  STROKE_RECEIVED: 'stroke:received',
  CANVAS_CLEAR: 'canvas:clear',
  CANVAS_CLEARED: 'canvas:cleared',
  CANVAS_UNDO: 'canvas:undo',
  CANVAS_REDO: 'canvas:redo',
  CANVAS_STATE: 'canvas:state',

  // Cursor events
  CURSOR_MOVE: 'cursor:move',
  CURSOR_UPDATE: 'cursor:update',

  // User presence events
  USER_JOIN: 'user:join',
  USER_LEAVE: 'user:leave',
  USERS_LIST: 'users:list',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
