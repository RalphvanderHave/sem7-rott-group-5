# /backend/models.py
from sqlalchemy import Column, String, Text, DateTime, JSON, LargeBinary, CheckConstraint, Index
from db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)



class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True)  # uuid
    username = Column(String, nullable=False, index=True)
    chat_id = Column(String, nullable=True, index=True)
    role = Column(String, nullable=False)  # user | assistant | system
    text = Column(Text, nullable=False)
    ts = Column(DateTime(timezone=True), nullable=False, index=True)
    meta = Column(JSON, nullable=True)

    __table_args__ = (
        CheckConstraint("role IN ('user','assistant','system')", name="ck_messages_role"),
    )


class Memory(Base):
    """
    Local Long-Term Memory (Mem0 Style)
    - text: A one-sentence "executable fact/preference"
    - tags: Optional list of tags
    - embedding: L2-normalized float32 vector (bytes)
    """
    __tablename__ = "memories"
    id = Column(String, primary_key=True)  # uuid
    username = Column(String, index=True, nullable=False)
    text = Column(Text, nullable=False)
    tags = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    embedding = Column(LargeBinary, nullable=False)


Index("ix_memories_username _created_at", Memory.username , Memory.created_at.desc())
