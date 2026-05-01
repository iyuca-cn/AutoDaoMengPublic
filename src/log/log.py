from loguru import logger
from sys import stderr, stdout
from pathlib import Path

log_path = Path(__file__).parent.parent.parent / "logs"
log_path.mkdir(parents=True, exist_ok=True)

logger.remove()

# ===============LOGURU的日志等级=============
#   TRACE < DEBUG < INFO < SUCCESS < WARNING < ERROR < CRITICAL
#     5      10      20      25        30       40       50

# TRACE不输出到标准输出，只输出到文件，适合大循环记录使用

# =================   TRACE   =================
# logger.add(
#     stdout,
#     format="<green>🌟 {time:YYYY-MM-DD HH:mm:ss}</green> | "
#             "<level>{level: ^8}</level> | "
#             "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
#             "<light-blue>🔍 {message}</light-blue>",
#             level="TRACE",
#             filter=lambda record: record["level"].name == "TRACE"
# )

logger.add(
    log_path / "trace.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "🔍 {message}",
    level="TRACE",
    filter=lambda record: record["level"].name == "TRACE",
)

# =================   DEBUG   =================
logger.add(
    stdout,
    format="<green>🌟 {time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: ^8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
    "<blue>🐛 {message}</blue>",
    level="DEBUG",
    filter=lambda record: record["level"].name == "DEBUG",
)

logger.add(
    log_path / "debug.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "🐛 {message}",
    level="DEBUG",
    filter=lambda record: record["level"].name == "DEBUG",
)


# =================   INFO   =================
logger.add(
    stdout,
    format="<green>🌟 {time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: ^8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
    "<magenta>✨ {message}</magenta>",
    level="INFO",
    filter=lambda record: record["level"].name == "INFO",
)

logger.add(
    log_path / "info.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "✨ {message}",
    level="INFO",
    filter=lambda record: record["level"].name == "INFO",
)


# =================   SUCCESS   =================
logger.add(
    stdout,
    format="<green>🌟 {time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: ^8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
    "<light-green>🎉 {message}</light-green>",
    level="SUCCESS",
    filter=lambda record: record["level"].name == "SUCCESS",
)

logger.add(
    log_path / "success.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "🎉 {message}",
    level="SUCCESS",
    filter=lambda record: record["level"].name == "SUCCESS",
)

# =================   WARNING   =================
logger.add(
    stderr,
    format="<green>🌟 {time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: ^8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
    "<yellow>⚠️  {message}</yellow>",
    level="WARNING",
    filter=lambda record: record["level"].name == "WARNING",
)

logger.add(
    log_path / "warning.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "⚠️  {message}",
    level="WARNING",
    filter=lambda record: record["level"].name == "WARNING",
)
# =================   ERROR   =================
logger.add(
    stderr,
    format="<green>🌟 {time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: ^8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
    "<red>💥 {message}</red>",
    level="ERROR",
    filter=lambda record: record["level"].name == "ERROR",
)

logger.add(
    log_path / "error.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "💥 {message}\n\n",
    level="ERROR",
    filter=lambda record: record["level"].name == "ERROR",
)
# =================   CRITICAL   =================
logger.add(
    stderr,
    format="<green>🌟 {time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: ^8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
    "<light-red><bold>🔥 {message}</bold></light-red>",
    level="CRITICAL",
    filter=lambda record: record["level"].name == "CRITICAL",
)

# =================   ALL   =================
logger.add(
    log_path / "all.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "{message}",
    level="DEBUG",
)


logger.add(
    log_path / "critical.log",
    format="🌟 {time:YYYY-MM-DD HH:mm:ss} | "
    "{level} | "
    "{name}:{function}:{line} - "
    "🔥 {message}",
    level="CRITICAL",
    filter=lambda record: record["level"].name == "CRITICAL",
)

if __name__ == "__main__":
    # @logger.catch
    def zero_div_test(a, b):
        return a / b

    # zero_div_test(5,0)

    try:
        zero_div_test(1, 0)
    except Exception as e:
        logger.exception(e)

    logger.trace("loguru日志库,轻松使用日志.")
    logger.debug("loguru日志库,轻松使用日志.")
    logger.info("loguru日志库,轻松使用日志.")
    logger.success("loguru日志库,轻松使用日志.")
    logger.warning("loguru日志库,轻松使用日志.")
    logger.error("loguru日志库,轻松使用日志.")
    logger.critical("loguru日志库,轻松使用日志.")
