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
  redoStack: DrawingStroke[];
}

// In-memory room storage
const rooms = new Map<string, RoomState>();

const getOrCreateRoom = (roomId: string): RoomState => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      strokes: [],
      redoStack: [],
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
    transports: ['polling', 'websocket'],
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
        room.redoStack = []; // Clear redo stack on new action
        socket.to(roomId).emit(SOCKET_EVENTS.STROKE_RECEIVED, stroke);
      }
    });

    // Handle real-time stroke streaming (points as they are drawn)
    socket.on(SOCKET_EVENTS.STROKE_STREAM, (data: { 
      roomId: string; 
      strokeId: string;
      userId: string;
      point: { x: number; y: number };
      color: string;
      width: number;
      tool: string;
      isStart: boolean;
    }) => {
      const { roomId, ...streamData } = data;
      socket.to(roomId).emit(SOCKET_EVENTS.STROKE_STREAM_RECEIVED, streamData);
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
    socket.on(SOCKET_EVENTS.CANVAS_UNDO, (data: { roomId: string }) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (room && room.strokes.length > 0) {
        const stroke = room.strokes.pop();
        if (stroke) {
          room.redoStack.push(stroke);
          // Broadcast new state to ALL users in the room
          io.to(roomId).emit(SOCKET_EVENTS.CANVAS_STATE, { strokes: room.strokes });
        }
      }
    });

    // Handle redo
    socket.on(SOCKET_EVENTS.CANVAS_REDO, (data: { roomId: string }) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (room && room.redoStack.length > 0) {
        const stroke = room.redoStack.pop();
        if (stroke) {
          room.strokes.push(stroke);
          // Broadcast new state to ALL users in the room
          io.to(roomId).emit(SOCKET_EVENTS.CANVAS_STATE, { strokes: room.strokes });
        }
      }
    });

    // Handle clear canvas
    socket.on(SOCKET_EVENTS.CANVAS_CLEAR, (data: { roomId: string }) => {
      const { roomId } = data;
      const room = rooms.get(roomId);

      if (room) {
        room.strokes = [];
        room.redoStack = [];
        io.to(roomId).emit(SOCKET_EVENTS.CANVAS_CLEARED);
      }
    });

    // Handle room-deleted
    socket.on(SOCKET_EVENTS.ROOM_DELETED, (data: { roomId: string}) => {
          console.log(`[Socket] Room deleted: ${data.roomId}`);
         const { roomId } = data
         const room = rooms.get(roomId)

             if(room) {
                io.to(roomId).emit(SOCKET_EVENTS.ROOM_DELETED, {
                roomId,
                reason: 'Room deleted by owner',
              });

              // Delete room from memory
              rooms.delete(roomId);

              console.log(`[Socket] Room ${roomId} deleted by Owner`);
         }
    })
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
