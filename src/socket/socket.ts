import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from './socket.events';

interface User {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  isOnline: boolean;
}

interface DrawingStroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
  tool: string;
  userId: string;
  timestamp: number;
}

interface RoomState {
  users: Map<string, User>;
  strokes: DrawingStroke[];
}

// In-memory room storage
const rooms = new Map<string, RoomState>();

const getOrCreateRoom = (roomId: string): RoomState => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      strokes: [],
    });
  }
  return rooms.get(roomId)!;
};

const getUsersArray = (room: RoomState): User[] => {
  return Array.from(room.users.values());
};

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    let currentRoomId: string | null = null;
    let currentUserId: string | null = null;

    // Join room
    socket.on(SOCKET_EVENTS.JOIN_ROOM, (data: {
      roomId: string;
      userId: string;
      userName: string;
      userColor: string;
    }) => {
      const { roomId, userId, userName, userColor } = data;

      // Leave previous room if any
      if (currentRoomId) {
        socket.leave(currentRoomId);
        const prevRoom = rooms.get(currentRoomId);
        if (prevRoom) {
          prevRoom.users.delete(currentUserId || '');
          io.to(currentRoomId).emit(SOCKET_EVENTS.USER_LEAVE, { userId: currentUserId });
          io.to(currentRoomId).emit(SOCKET_EVENTS.USERS_LIST, getUsersArray(prevRoom));
        }
      }

      currentRoomId = roomId;
      currentUserId = userId;

      socket.join(roomId);
      const room = getOrCreateRoom(roomId);

      const user: User = {
        id: userId,
        name: userName,
        color: userColor,
        cursor: null,
        isOnline: true,
      };

      room.users.set(userId, user);

      // Send current room state to the joining user
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, {
        users: getUsersArray(room),
        strokes: room.strokes,
      });

      // Notify others about the new user
      socket.to(roomId).emit(SOCKET_EVENTS.USER_JOIN, user);
      io.to(roomId).emit(SOCKET_EVENTS.USERS_LIST, getUsersArray(room));

      console.log(`[Socket] User ${userName} (${userId}) joined room ${roomId}`);
    });

    // Leave room
    socket.on(SOCKET_EVENTS.LEAVE_ROOM, (data: { roomId: string; userId: string }) => {
      const { roomId, userId } = data;
      socket.leave(roomId);

      const room = rooms.get(roomId);
      if (room) {
        room.users.delete(userId);
        io.to(roomId).emit(SOCKET_EVENTS.USER_LEAVE, { userId });
        io.to(roomId).emit(SOCKET_EVENTS.USERS_LIST, getUsersArray(room));

        // Clean up empty rooms
        if (room.users.size === 0) {
          rooms.delete(roomId);
        }
      }

      currentRoomId = null;
      currentUserId = null;

      console.log(`[Socket] User ${userId} left room ${roomId}`);
    });

    // Handle stroke
    socket.on(SOCKET_EVENTS.STROKE_ADD, (data: { roomId: string; stroke: DrawingStroke }) => {
      const { roomId, stroke } = data;
      const room = rooms.get(roomId);

      if (room) {
        room.strokes.push(stroke);
        socket.to(roomId).emit(SOCKET_EVENTS.STROKE_RECEIVED, stroke);
      }
    });

    // Handle cursor move
    socket.on(SOCKET_EVENTS.CURSOR_MOVE, (data: {
      roomId: string;
      userId: string;
      position: { x: number; y: number } | null;
    }) => {
      const { roomId, userId, position } = data;
      const room = rooms.get(roomId);

      if (room) {
        const user = room.users.get(userId);
        if (user) {
          user.cursor = position;
        }
        socket.to(roomId).emit(SOCKET_EVENTS.CURSOR_UPDATE, { userId, position });
      }
    });

    // Handle undo
    socket.on(SOCKET_EVENTS.CANVAS_UNDO, (data: { roomId: string; strokes: DrawingStroke[] }) => {
      const { roomId, strokes } = data;
      const room = rooms.get(roomId);

      if (room) {
        room.strokes = strokes;
        socket.to(roomId).emit(SOCKET_EVENTS.CANVAS_STATE, { strokes });
      }
    });

    // Handle redo
    socket.on(SOCKET_EVENTS.CANVAS_REDO, (data: { roomId: string; strokes: DrawingStroke[] }) => {
      const { roomId, strokes } = data;
      const room = rooms.get(roomId);

      if (room) {
        room.strokes = strokes;
        socket.to(roomId).emit(SOCKET_EVENTS.CANVAS_STATE, { strokes });
      }
    });

    // Handle clear canvas
    socket.on(SOCKET_EVENTS.CANVAS_CLEAR, (data: { roomId: string }) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (room) {
        room.strokes = [];
        io.to(roomId).emit(SOCKET_EVENTS.CANVAS_CLEARED);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);

      if (currentRoomId && currentUserId) {
        const room = rooms.get(currentRoomId);
        if (room) {
          room.users.delete(currentUserId);
          io.to(currentRoomId).emit(SOCKET_EVENTS.USER_LEAVE, { userId: currentUserId });
          io.to(currentRoomId).emit(SOCKET_EVENTS.USERS_LIST, getUsersArray(room));

          if (room.users.size === 0) {
            rooms.delete(currentRoomId);
          }
        }
      }
    });
  });

  return io;
};
