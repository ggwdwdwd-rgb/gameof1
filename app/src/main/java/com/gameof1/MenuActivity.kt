package com.gameof1

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.gameof1.databinding.ActivityMenuBinding

/**
 * Splash / main-menu screen.
 *
 * Presents the game title and two buttons: start a new game or exit.
 */
class MenuActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMenuBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMenuBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnNewGame.setOnClickListener {
            startActivity(Intent(this, GameActivity::class.java))
        }

        binding.btnExit.setOnClickListener {
            finishAffinity()
        }
    }
}
