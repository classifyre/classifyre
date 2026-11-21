When the SQL gateway is short of memory it now refuses new connections as busy, so tools retry, instead of being restarted and dropping every open connection.
