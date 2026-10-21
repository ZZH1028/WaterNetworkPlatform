FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN python scripts/build_web.py
EXPOSE 8000
CMD ["python", "api/server.py", "--host", "0.0.0.0", "--port", "8000"]
