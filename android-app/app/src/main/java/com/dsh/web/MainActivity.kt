package com.dsh.web

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast

/**
 * WebView shell for the DeepSeek Harness web GUI. Tries the primary
 * server first and fails over to the backup on a main-frame error.
 * Tapping the server badge in the corner cycles to the next server.
 */
class MainActivity : Activity() {

    private val servers = listOf(
        "http://100.84.234.109:3080/",
        "http://100.92.235.21:3080/"
    )

    private var current = 0
    private lateinit var webView: WebView
    private lateinit var badge: TextView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("dsh", MODE_PRIVATE)
        current = prefs.getInt("server", 0).coerceIn(0, servers.lastIndex)

        val root = FrameLayout(this)

        webView = WebView(this)
        webView.setBackgroundColor(Color.BLACK)
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                badge.text = "⚡ ${hostOf(servers[current])}"
            }

            override fun onPageFinished(view: WebView, url: String) {
                prefs.edit().putInt("server", current).apply()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (!request.isForMainFrame) return
                // Fail over to the next server; a second failure keeps
                // the user on it instead of looping.
                val next = (current + 1) % servers.size
                if (next != current) {
                    current = next
                    webView.loadUrl(servers[next])
                }
            }
        }
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))

        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        badge = TextView(this)
        badge.setTextColor(0xFFE0E0E0.toInt())
        badge.setBackgroundColor(0x99202020.toInt())
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        badge.setPadding(dp(10), dp(6), dp(10), dp(6))
        val badgeParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        )
        badgeParams.gravity = Gravity.TOP or Gravity.START
        badgeParams.setMargins(dp(8), dp(8), 0, 0)
        badge.layoutParams = badgeParams
        badge.setOnClickListener {
            current = (current + 1) % servers.size
            webView.loadUrl(servers[current])
            Toast.makeText(this, servers[current], Toast.LENGTH_SHORT).show()
        }
        root.addView(badge)

        setContentView(root)
        webView.loadUrl(servers[current])
    }

    private fun hostOf(url: String) =
        url.removePrefix("http://").removePrefix("https://").removeSuffix("/")

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
